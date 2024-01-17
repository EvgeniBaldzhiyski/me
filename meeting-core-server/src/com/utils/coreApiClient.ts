import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import axiosObservable from 'axios-observable';
import {addLogger} from 'axios-debug-log';
import axiosRetry from 'axios-retry';
import { Agent } from 'http';
import debug from 'debug';
import { URL } from 'url';
import serverConfig from './serverConfig';

const httpAgent = new Agent({
  keepAlive: true,
  maxSockets: 100
});

const axiosConfig = {
  baseURL: Object.assign(
    new URL('http://core-api/api'),
    {
      protocol: serverConfig.CONFIG.apiServerProtocol || 'http',
      hostname: serverConfig.CONFIG.apiServerHost || 'core-api',
      port: (serverConfig.CONFIG.apiServerPort || '').toString(),
      pathname: serverConfig.CONFIG.apiServerEndpoint
    } as URL
  ).toString(),
  httpAgent
} as AxiosRequestConfig;

if (serverConfig.CONFIG.apiServerToken) {
  axiosConfig.headers = axiosConfig.headers || {};
  axiosConfig.headers.common = axiosConfig.headers.common || {};
  axiosConfig.headers.common['Authorization'] = `Bearer ${serverConfig.CONFIG.apiServerToken}`;
}

function setupAxios(axiosInstance: AxiosInstance): AxiosInstance {
  axiosRetry(axiosInstance, {
    retries: 3,
    // the provided default is better :)
    // ```
    // retryCondition: isNetworkOrIdempotentRequestError
    // A callback to further control if a request should be retried.
    // By default, it retries if it is a network error or a 5xx error
    // on an idempotent request (GET, HEAD, OPTIONS, PUT or DELETE).
    // ```
    // retryCondition: error => error.code === 'EAI_AGAIN',
    retryDelay: axiosRetry.exponentialDelay
  });
  addLogger(axiosInstance, debug('axios').extend('core-api'));
  return axiosInstance;
}

/**
 * @deprecated use `coreApiObservable` see https://github.com/interactive/conference/pull/2429
 */
export const coreApi = setupAxios(axios.create(axiosConfig));

/**
 * Observable coreApi client using [axios-observable](https://github.com/zhaosiyang/axios-observable)
 *
 * ```
 * Observable (as opposed to Promise) based HTTP client for the browser and node.js
 * Want to use axios in a rxjs (observable) way? There we go!
 * This API of axios-observable is almost same as API of axios, giving you smooth transition.
 * So the documentation mirrors the one of axios (A few exceptions will be cleared pointed out).
 * ```
 */
export const coreApiObservable = axiosObservable.create(axiosConfig);
// NOTE: A hacky way to access the `private axiosInstance: AxiosInstance`
//       see https://github.com/zhaosiyang/axios-observable/blob/master/lib/index.ts#L13
setupAxios((coreApiObservable as any)['axiosInstance']);

