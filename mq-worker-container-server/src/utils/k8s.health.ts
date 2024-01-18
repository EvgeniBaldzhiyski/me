// TODO: This is used in other boxes, too. Figure out a common place to share such utilities between services.
import config from 'config';
import express from 'express';
import client from 'prom-client';
import { createTerminus, TerminusOptions } from '@godaddy/terminus';
import { createServer as createHttpServer, Server } from 'http';


export class K8sHealthCheck {
  private static instance: K8sHealthCheck;

  private readonly webServer: Server;
  private readonly app: express.Application;

  private isTerminating: boolean;

  private readinessChecks: { [key: string]: () => boolean };
  private healthChecks: { [key: string]: () => boolean };

  constructor() {
    this.app = express();
    this.webServer = createHttpServer(this.app);

    this.isTerminating = false;

    this.readinessChecks = {};
    this.healthChecks = {};
  }

  static getInstance(): K8sHealthCheck {
    if (!(K8sHealthCheck.instance instanceof K8sHealthCheck)) {
      K8sHealthCheck.instance = new K8sHealthCheck();
    }
    return K8sHealthCheck.instance;
  }

  setReadinessCheck(name: string, check: () => boolean): void {
    this.readinessChecks[name] = check;
  }

  setHealthCheck(name: string, check: () => boolean): void {
    this.healthChecks[name] = check;
  }

  setupHealthHandler(onStopSignal: () => Promise<unknown>): void {
    const terminusOptions: TerminusOptions = {
      healthChecks: {
        '/__health': () => this.isHealthy(),
        '/__gtg': () => this.isReady()
      },
      signals: ['SIGTERM', 'SIGINT'],
      onSignal: () => {
        this.isTerminating = true;
        return onStopSignal();
      },
      // Set grace to Infinity to not force-close the http server.
      // this is required so the `/metrics` and other related endpoints keep on working during the long
      // termination grace we use for the SSR / PWR / Phone Mixer boxes
      // see https://www.npmjs.com/package/stoppable
      // TODO: Consider replacing https://github.com/godaddy/terminus with custom made library as it is too opinionated
      timeout: Infinity,
      // NOTE: This blocks the https://github.com/godaddy/terminus from closing the HTTP server
      //       in order for the `/metrics` endpoint and others to be responsive
      //       and thus Prometheus to collect the metrics
      beforeShutdown: () => new Promise<void>(() => void 0),
      // NOTE: This should allow proper calls to the `/__health` and `/__gtg` endpoints
      //       even during the long termination grace period
      sendFailuresDuringShutdown: false
      // TODO: end of considerable block
    };

    createTerminus(this.webServer, terminusOptions);
    this.webServer.listen(config.get('insights.server.port'), config.get('insights.server.host'));
  }

  setupMetricsHandler(refreshMetrics: () => void): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.app.get('/__metrics', async (req: express.Request, res: express.Response) => {
      refreshMetrics();
      const metrics = await client.register.metrics();
      res.writeHead(
        200,
        {
          'content-type': client.register.contentType,
          'content-length': Buffer.byteLength(metrics, 'utf8')
        }
      );
      res.end(metrics);
    });
  }

  setupWIPHandler(idleFlagGetter: () => boolean): void {
    const wipHandler = (req: express.Request, res: express.Response) => {
      const isIdle = idleFlagGetter();
      if (isIdle) {
        res.status(555).send('NOT WORKING');
      } else {
        res.status(200).send('WORKING');
      }
    };

    this.app.get('/__wip', wipHandler);
  }

  private isHealthy(): Promise<void> {
    return new Promise((resolve, reject) => {
      for (const [check, status] of Object.entries(this.healthChecks)) {
        if (!status()) {
          reject({ [check]: 'failed' });
          break;
        }
      }

      resolve();
    });
  }


  private isReady(): Promise<void> {
    // By definition Terminus server should always return "not ready", when the app is shutting down.
    // Source: https://github.com/godaddy/terminus
    if (this.isTerminating) {
      return Promise.reject();
    }

    return new Promise((resolve, reject) => {
      for (const [check, status] of Object.entries(this.readinessChecks)) {
        if (!status()) {
          reject({ [check]: 'failed' });
          break;
        }
      }

      resolve();
    });
  }
}
