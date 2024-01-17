import apm from 'elastic-apm-node/start';
import config from 'config';
import http from 'http';
import { createTerminus, HealthCheckError } from '@godaddy/terminus';
import Server from './com/utils/Server';
import Echo from './com/apps/Echo';
import Meeting from './com/apps/meeting/Meeting';
import RestApi from './com/apps/restapi/RestApi';
import RestApiServer from './com/apps/restapi/RestApiServer';
import Admin from './com/apps/admin/Admin';
import { mongoClient } from './com/database';
import { emergencyHandler } from './com/utils/emergencyHandler';
import { processLogger } from './com/utils/processLogger';
import SutApplication from './com/apps/sut/SutApplication';
import { ServiceRegistrar } from './com/apps/service-registrar/service-registrar-app';
import { ServiceRegistry } from './com/apps/service-registrar/service-registry';
import ServiceRegistryHealth from './com/apps/service-registrar/service-registry-health';
import { catchError, filter, mergeMapTo, take, timeout } from 'rxjs/operators';
import { BehaviorSubject, from, of, race } from 'rxjs';
import process, { kill } from 'process';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './active-meeting-api/app.module';
import { join } from 'path';
import { drainModeGauge } from './com/metrics/metrics';

process.on('uncaughtException', emergencyHandler);
process.on('unhandledRejection', emergencyHandler);

processLogger.info('node-config: ', {
  NODE_ENV: config.util.getEnv('NODE_ENV'),
  NODE_CONFIG_ENV: config.util.getEnv('NODE_CONFIG_ENV'),
  NODE_APP_INSTANCE: config.util.getEnv('NODE_APP_INSTANCE'),
  configSources: config.util.getConfigSources().map(cs => cs.name)
});

(async () => {
  const server = new Server();

  // access: <root domain>/service-registrar/api/<name of endpoint>/...
  server.addApp('service-registrar', ServiceRegistrar, {
    server
  }, {
    defname: 'api',
    autoStart: true
  });

  server.addApp('echo', Echo);
  server.addApp('admin', Admin);
  server.addApp('meeting', Meeting, undefined, {dependsOn: ['admin'], limited: true});

  // access: <root domain>/restapi/get/<name of endpoint>/...
  server.addApp('restapi', RestApi, {
    server: new RestApiServer(server),
  }, {
    defname: 'get',
    autoStart: true
  });

  if (config.get('sut.enabled')) {
    server.addApp('sut', SutApplication, { server }, {
      defname: 'testing',
      autoStart: true
    });
  }

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule.register(server), {
    transport: Transport.GRPC,
    options: {
      url: `${config.get('grpc.address')}:${config.get('grpc.port')}`,
      package: ['ActiveMeeting', 'ActiveMeetingContext', 'ActiveMeetingSchedulingController', 'WhiteboardMeetingContext'],
      protoPath: [
        'active-meeting-context/active_meeting.proto',
        'active-meeting-context/active_meeting_context.proto',
        'active-meeting-context/active_meeting_scheduling.proto',
        'active-meeting-context/whiteboard/whiteboard_meeting_context.proto'
      ],
      keepalive: config.get('grpc.keepalive'),
      channelOptions: config.get('grpc.channelOptions'),
      loader: {
        includeDirs: [
          'node_modules/@container/proto-definitions',
          join(__dirname, 'proto-definitions')
        ],
      }
    },
  });

  app.listen(() => {
    processLogger.info('gRPC endpoint started');
  });

  async function shutdownServer() {
    processLogger.info('Server is going to shutdown all the Sessions...');
    try {
      await server.shutdown();
      await app.close();
      processLogger.info('Server has shutdown all the Sessions');
    } catch (e) {
      // NOTE: internally the server.shutdown() is using Promise.allSettled, so this exception should never happen
      apm.captureError(e);
      processLogger.error(`Failed shutting down all sessions. ${e.message}`);
      // keep on shutting down
    }
  }

  async function enableDrainMode() {
    processLogger.info('Enabling drain mode...');
    try {
      await ServiceRegistry.drainMode();
      processLogger.info('The server stopped to accept new connections.');

      // set metrics for drain mode
      drainModeGauge.set(1);
    } catch (e) {
      apm.captureError(e);
      processLogger.error(`Failed to enable drain mode. ${e.message}`);
      // keep on shutting down
    }
  }

  // time to wait all connection to be closed: terminationTimeout - 2min
  const terminationTimeout = (+config.get('terminationGracePeriodSeconds') - 120) * 1000;
  // wait for all client connection closed
  const waitConnections$ = server.connectionCount$.pipe(
    timeout(terminationTimeout),
    filter(count => count < 1),
    take(1),
    catchError(_ => {
      processLogger.warn(`Termination timeout (${terminationTimeout}ms) elapsed.`);
      return of(0);
    })
  );

  const killImmediately$ = new BehaviorSubject(false);
  process.once('SIGUSR1', () => {
    processLogger.info(`SIGUSR1 - Force server shutdown!`);
    killImmediately$.next(true);
    kill(process.pid, 'SIGTERM');
  });

  async function beforeShutdown() {
    if (!killImmediately$.value) {
      await race(
        killImmediately$.pipe(
          filter(kill => kill),
          take(1)
        ),
        from(enableDrainMode()).pipe(
          mergeMapTo(waitConnections$)
        )
      ).toPromise();
    }
    return shutdownServer();
  }

  async function onShutdown() {
    processLogger.info('Server is now waiting to flush APM ...');
    return new Promise<void>(() => {
      apm.flush(() => {
        processLogger.info('Server has flushed the APM, now it\'s going to exit ...');
        // Force exit here because probably there are not completed promises in task queue implementation
        process.exit();
      });
    });
  }

  const healthChecksEndpoints = {
    '/__health': async () => {
      return true;
    },
    '/__gtg': async () => {
      return Promise.all([
        (new Promise<void>((resolve, reject) => (ServiceRegistryHealth.swsrRegistrationAttemptsExhausted ? resolve() : reject())))
          .then(() => ({ 'serviceInstance:': 'active' }))
          .catch(() => {
            throw new HealthCheckError('readiness probe failed', 'SWSR self-registration failed');
          }),
        (new Promise<void>((resolve, reject) => (mongoClient.isConnected() ? resolve() : reject())))
          .then(() => ({ 'mongodb:connection': 'ok' }))
          .catch(() => {
            throw new HealthCheckError('mongodb:connection', { 'mongodb:connection': 'nok' });
          })
      ]);
    },
    [`/${ServiceRegistry.healthCheckPath}`]: () => ServiceRegistryHealth.probe()
  };

  const insightsServer = http.createServer((request, response) => {
    if (!(request.url in healthChecksEndpoints)) {
      response.statusCode = 404;
    }
    response.end('');
  });

  createTerminus(insightsServer, {
    healthChecks: {
      verbatim: true, // [optional = false] use object returned from /healthcheck verbatim in response,
      ...healthChecksEndpoints
    },
    // cleanup options
    timeout: 30000,
    signal: 'SIGTERM',
    sendFailuresDuringShutdown: false,
    beforeShutdown,
    onShutdown,

    logger: (msg: string, err: Error) => {
      processLogger.error(msg, err);
    }
  });

  insightsServer.listen(config.get('insights.server.port'), config.get('insights.server.host'));
})();

