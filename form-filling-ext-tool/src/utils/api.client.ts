export enum UserRoles {
  ISM_PERMISSION = 'ISM_PERMISSION',
  COUNTRY_PERMISSION = 'COUNTRY_PERMISSION',
  WAGE_PERMISSION = 'WAGE_PERMISSION',
  DATA_RULES_PERMISSION = 'DATA_RULES_PERMISSION'
}

export interface UserPermissions {
  role: UserRoles;
}

export interface LoginResponse {
  userId: number;
  userType: 'organization';
  preferredLanguageCode: string;
  permissions: UserPermissions[];
  enabled: boolean;
  organizationTypeId: number;
}

export class ApiClientError {
  type = 'ApiClientError';

  constructor(
    public code,
    public text,
    public url,
    public data,
    public raw: Response
  ) {}
}

export enum ReturnType {
  BLOB,
  TEXT,
  JSON,
  FORM_DATA
}


class ApiClient {
  private token = '';

  lastResponse: Response;

  get<T>(url: string, options?: RequestInit & {returnType?: ReturnType}): Promise<T> {
    return this.request<T>(url, undefined, {...options, method: 'GET'});
  }

  post<T>(url: string, data?: object, options?: RequestInit & {returnType?: ReturnType}) {
    return this.request<T>(url, data, {...options, method: 'POST'});
  }

  put<T>(url: string, data?: object, options?: RequestInit & {returnType?: ReturnType}) {
    return this.request<T>(url, data, {...options, method: 'PUT'});
  }

  del<T>(url: string, data?: object, options?: RequestInit & {returnType?: ReturnType}) {
    return this.request<T>(url, data, {...options, method: 'DELETE'});
  }

  get initialized(): boolean {
    return !!this.token;
  }

  reset() {
    this.token = '';
  }

  async init(url: string, username: string, password: string): Promise<LoginResponse> {
    const res = await this.post<LoginResponse & {token: string}>(url, {username, password});

    const {token, ...data} = res;

    this.token = token;

    return data;
  }

  async request<T>(url: string, data?: object, options?: RequestInit & {returnType?: ReturnType}): Promise<T> {
    const {returnType, ..._options} = options || {};

    if (options.method.toLocaleUpperCase() === 'GET') {
      data = undefined;
      // @todo convert options.body to url params
    }

    const config = {
      ..._options,
      method: _options.method || 'GET',
      mode: _options.mode || 'cors', // no-cors, *cors, same-origin
      cache: _options.cache || 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      credentials: _options.credentials || 'same-origin', // include, *same-origin, omit
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.token
      },
      body: JSON.stringify(data),
      redirect: _options.redirect || 'follow', // manual, *follow, error
      referrerPolicy: _options.referrerPolicy || 'no-referrer', // no-referrer, *client
    };

    console.log('--------- REQ DATA -->', config);

    let res: Response;

    try {
      res = await fetch(url, config);
    } catch (err) {
      throw new ApiClientError(500, err.message, url, {...config}, {} as Response);
    }

    if (res.status !== 200) {
      throw new ApiClientError(res.status, res.statusText, url, {...config}, res.clone());
    }

    this.lastResponse = res.clone();

    switch(returnType) {
      case ReturnType.BLOB:
        return res.blob() as Promise<T>;
      case ReturnType.TEXT:
        return res.text() as Promise<T>;
      case ReturnType.FORM_DATA:
        return res.formData() as Promise<T>;
      default:
        return res.json() as Promise<T>;
    }
  }
}

export const apiClient = new ApiClient();
