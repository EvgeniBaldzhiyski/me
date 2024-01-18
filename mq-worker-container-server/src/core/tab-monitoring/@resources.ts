export enum MonitoringApi {
  ONLINE = 'MON_CLIENT_IS_ONLINE',
  OFFLINE = 'MON_CLIENT_IS_OFFLINE',
  ALIVE = 'MON_CLIENT_IS_ALIVE',
  ERROR_EVENT = 'MON_ERROR_EVENT',
  MEDIA_CONNECTION_CHANGE = 'MON_MEDIA_CONNECTION_CHANGE',
  SOCKET_CONNECTION_CHANGE = 'MON_SOCKET_CONNECTION_CHANGE',
  APP_REFRESH = 'MON_APP_REFRESH',
  APP_INITIALIZED = 'MON_APP_INITIALIZED',
  APP_READY = 'MON_APP_READY',
  APP_EXIT_ERROR = 'MON_APP_EXIT_ERROR',
  APP_EXIT_LOGOUT = 'MON_APP_EXIT_LOGOUT',
}

export interface MonitoringEvent {
  readonly scope: 'MonitoringServiceEvent';
  readonly command: MonitoringApi;
  readonly timestamp: number;
  readonly body: unknown;
}

export interface MonitorEventCollection {
  command: MonitoringApi | 'TAB_UPDATE';
  timestamp: number;
  body: unknown;
}

export class TabCommunicationError extends Error {
  constructor(message: string, public type: MonitoringApi) {
    super(message);
  }
}

export class AppRefreshError extends Error {}
