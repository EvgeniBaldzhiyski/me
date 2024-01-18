import { AxiosInstance } from 'axios';
import axiosObservable from 'axios-observable';
import {addLogger} from 'axios-debug-log';
import axiosRetry from 'axios-retry';
import { default as HttpAgent, HttpsAgent } from 'agentkeepalive';
import debug from 'debug';
import { URL } from 'url';
import config from 'config';

const axiosConfig = {
  baseURL: Object.assign(
    new URL('http://core-api/api'),
    {
      protocol: config.get('coreApi.protocol') || 'http',
      hostname: config.get('coreApi.hostname') || 'core-api',
      port: (config.get('coreApi.port') || '').toString(),
      pathname: config.get('coreApi.pathname')
    } as URL
  ).toString(),
  httpAgent: new HttpAgent(),
  httpsAgent: new HttpsAgent(),
  headers: {}
};

if (config.get('coreApi.token')) {
  axiosConfig.headers = {
    ...axiosConfig.headers,
    Authorization: `Bearer ${config.get('coreApi.token')}`
  };
}

function setupAxios(axiosInstance: AxiosInstance): AxiosInstance {
  axiosRetry(axiosInstance, {
    retries: config.get('coreApi.maxRetryAttempts'),
    // the provided default is better :)
    // ```
    // retryCondition: isNetworkOrIdempotentRequestError
    // A callback to further control if a request should be retried.
    // By default, it retries if it is a network error or a 5xx error
    // on an idempotent request (GET, HEAD, OPTIONS, PUT or DELETE).
    // ```
    // retryCondition: error => error.code === 'EAI_AGAIN',
    // eslint-disable-next-line @typescript-eslint/unbound-method
    retryDelay: axiosRetry.exponentialDelay
  });

  addLogger(axiosInstance, debug('axios').extend('core-api'));

  return axiosInstance;
}

export const coreApi = axiosObservable.create(axiosConfig);
// NOTE: A hacky way to access the `private axiosInstance: AxiosInstance`
//       see https://github.com/zhaosiyang/axios-observable/blob/master/lib/index.ts#L13
// eslint-disable-next-line dot-notation,
setupAxios(coreApi['axiosInstance']);
