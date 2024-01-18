import logger from './core/logger';
import apm from 'elastic-apm-node/start';

function traceError(error: Error, stage: string): void {
  logger.error(error.stack, stage);

  apm.flush(() => {
    logger.log('Exiting...', stage);
    try {
      nw.App.quit();
    } finally {
      process.exit(101);
    }
  });
}

// just in case we have missed something
process.on('uncaughtException', exception => {
  traceError(exception, 'runtime / exception');
});
process.on('unhandledRejection', exception => {
  traceError(new Error(JSON.stringify(exception)), 'runtime / promise');
});

// give a time uncaughtException and unhandledRejection to init
import config from 'config';
import { K8sHealthCheck } from './utils/k8s.health';
import { capacityGauge, loadGauge, totalCapacityGauge } from './utils/metrics';
import { TranscribeWorkerFactory } from './services/transcribing/transcribe-worker';
import { WorkerFactory } from '@jigsawinteractive/task-queue';
import { RmqGateway } from './communication/rmq.gateway';
import { SsrWorkerFactory } from './services/ssr/ssr-worker';
import { writeFile } from 'fs/promises';
import { VoiceWorkerFactory } from './services/voice/voice.worker';
import { kafkaProducer } from './utils/kafka-producer';

let rabbit: RmqGateway;

/**
 * stop
 * Stops the box
 */
async function stop(signal: string, rmq: RmqGateway) {
  logger.log(`Received ${signal} signal`, 'shutdown');

  try {
    if (typeof rmq === 'object') {
      await rmq.stopConsuming();
      await kafkaProducer.shutdown();
    }
  } catch (exception) {
    traceError(exception, 'shutdown');
  } finally {
    apm.flush(() => {
      logger.log('Exiting...', 'shutdown');
      try {
        nw.App.quit();
      } finally {
        process.exit(0);
      }
    });
  }
}

// We want to initialize signal handlers as early as possible, because of Kubernetes sometimes
// sending signals within milliseconds after the box has started. This is why these are even before
// the imports.
process.on('SIGTERM', () => void stop('SIGTERM', rabbit)); // docker stop
process.on('SIGINT', () => void stop('SIGINT', rabbit)); // Ctrl+C

/**
 * checkConsumerHealth
 * RabbitMQ health check
 */
function checkConsumerHealth(rmq: RmqGateway): boolean {
  // currently, rabbitmq connection does not recover, so we want to restart the box to force it reconnect
  const isWorking = rmq.isWorking;
  if (!isWorking) {
    logger.error('Lost one or more RabbitMQ connections', 'health.check');
  }

  return isWorking;
}

/**
 * start
 * Stats up transcribe box
 */
void (async function start() {
  try {
    await writeFile(config.get('service.pidSource'), process.pid.toString());
  } catch (err) {
    traceError(err, 'runtime / exception');
  }

  let workerFactory: WorkerFactory;
  switch (config.get('service.name')) {
    case 'transcribe-box': {
      workerFactory = new TranscribeWorkerFactory();
      break;
    }
    case 'ssr-box': {
      workerFactory = new SsrWorkerFactory();
      break;
    }
    case 'voice-box': {
      workerFactory = new VoiceWorkerFactory();
      break;
    }
  }

  if (config.get('showEnvVars')) {
    logger.debug(`OUTPUT ENV: ${JSON.stringify(process.env, null, 4)}`);
  }

  // if there a disconnect is emit during work the box will be blocked for more tasks. Fix async problems related with the reconnection
  rabbit = new RmqGateway(workerFactory, () => {
    void stop('SIGTERM', rabbit);
  });

  try {
    await rabbit.startConsuming(); // it will call transcribe.worker upon receiving a message

    logger.log(
      `Successfully connected to RabbitMQ. Starting to listen for messages on queue: ${config.get('taskQueue.queueName')}`,
      'startup'
    );

    // // health
    const healthCheck = K8sHealthCheck.getInstance();

    healthCheck.setHealthCheck('rabbit', () => checkConsumerHealth(rabbit));
    healthCheck.setupHealthHandler(() => stop('SIGTERM', rabbit));

    // metrics
    healthCheck.setupWIPHandler(() => rabbit.idle); // we need to pass a function to make it update dynamically
    healthCheck.setupMetricsHandler(() => {
      capacityGauge.set(rabbit.capacity);
      loadGauge.set(rabbit.load);
      totalCapacityGauge.set(rabbit.totalCapacity);
    });
  } catch (exception) {
    traceError(exception, 'startup');
  }
})();
