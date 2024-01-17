import apm from 'elastic-apm-node/start';
import http from 'http';
import { AxiosError } from 'axios';
import { processLogger } from './processLogger';

export function emergencyHandler(err: Error | AxiosError | any) {
  const custom = {} as { axios?: Partial<AxiosError> & any };

  let error: Error | AxiosError;
  if (typeof err === 'string') {
    error = new Error(err);
  } else if (err instanceof Error) {
    error = err;
  } else {
    error = new Error('Unknown non-standard error');
  }

  if (error.hasOwnProperty('isAxiosError')) {
    const e = error as AxiosError & {request?: http.ClientRequest};
    custom.axios = {
      code: e.code,
      config: {
        baseURL: e.config.baseURL,
        url: e.config.url,
        method: e.config.method,
        headers: e.config.headers
      },
      request: e.request && {
        finished: e.request.finished,
        aborted: e.request.aborted,
        destroyed: e.request.destroyed,
        headersSent: e.request.headersSent,
        protocol: e.request.protocol,
        host: e.request.host,
        port: e.request.port,
        method: e.request.method,
        path: e.request.path,
        headers: e.request.headers
      },
      response: e.response && {
        status: e.response.status,
        statusText: e.response.statusText,
        headers: e.response.headers
      }
    };
  }
  apm.captureError(error, { handled: false, custom });
  processLogger.error(`UNHANDLED EMERGENCY ERROR!`, {stack: error.stack});
  // TODO: Make sure we handle all errors!!!
  // apm.flush(() => {
  //   process.exit(99);
  // });
}
