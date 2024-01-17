import { AxiosInstance, AxiosRequestConfig } from 'axios';
import axiosObservable from 'axios-observable';
import {addLogger} from 'axios-debug-log';
import axiosRetry from 'axios-retry';
import { default as HttpAgent, HttpsAgent } from 'agentkeepalive';
import debug from 'debug';
import { URL } from 'url';
import serverConfig from './serverConfig';

function setupAxios(axiosInstance: AxiosInstance): AxiosInstance {
  axiosRetry(axiosInstance, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay
  });
  addLogger(axiosInstance, debug('axios').extend('api'));
  return axiosInstance;
}

export default function AxiosApiClientFacade(apiName: string) {
  this.axiosConfig = {
    baseURL: Object.assign(
      new URL(`${serverConfig.CONFIG.apis[apiName].protocol}://${serverConfig.CONFIG.apis[apiName].hostname}`),
      {
        protocol: serverConfig.CONFIG.apis[apiName].protocol,
        hostname: serverConfig.CONFIG.apis[apiName].hostname,
        port: (serverConfig.CONFIG.apis[apiName].port).toString(),
        pathname: serverConfig.CONFIG.apis[apiName].pathname
      } as URL).toString(),
    httpAgent: new HttpAgent(),
    httpsAgent: new HttpsAgent()
  } as AxiosRequestConfig;

  this.axiosConfig.headers = this.axiosConfig.headers || {};
  this.axiosConfig.headers.common = this.axiosConfig.headers.common || {};
  this.axiosConfig.headers.common['Authorization'] = `Bearer ${serverConfig.CONFIG.apis[apiName].accessToken}`;

  this.client = axiosObservable.create(this.axiosConfig);

  setupAxios((this.client as any)['axiosInstance']);
}
