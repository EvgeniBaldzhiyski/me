import { Targets } from '../targets.enum';
import { ApiClientError, LoginResponse, ReturnType, apiClient } from './api.client';
import config from './config';
import { GetFileOptions } from './interfaces';

export function logout(): void {
  return apiClient.reset();
}

export function login(name: string, pass: string): Promise<LoginResponse | ApiClientError> {
  return apiClient.init(`${config.get('api.url')}${config.get('api.links.login')}`, name, pass);
}

export function isLogged(): boolean {
  return apiClient.initialized;
}

export function getTargetPosting<R = object>(target: Targets, id: string): Promise<R> {
  return apiClient.get(`${config.get('api.url')}${config.get('api.links.notification')}/${target}/${id}`);
}

export function getTargetPostings<R = object[]>(target: Targets): Promise<R> {
  return apiClient.get<R>(`${config.get('api.url')}${config.get('api.links.notifications')}/${target}`);
}

export async function getFile(options: GetFileOptions): Promise<{name: string; blob: Blob}> {
  const blob = await apiClient.request<Blob>(
    `${config.get('api.url')}${options.url}`,
    options.data,
    {
      returnType: ReturnType.BLOB,
      method: options.method
    }
  );

  const parseFileName = apiClient.lastResponse.headers.get('content-disposition').match(/="([^"]+)"/);

  return {blob, name: parseFileName ? parseFileName[1] : 'unknown'};
}

export function fetchData<T = object>(url: string, data?: object, options?: RequestInit & {returnType?: ReturnType}): Promise<T> {
  return apiClient.request<T>(`${config.get('api.url')}${url}`, data, options);
}
