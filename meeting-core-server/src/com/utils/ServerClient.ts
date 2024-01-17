import WebSocket from 'ws';
import apm from 'elastic-apm-node/start';
import Client from './Client';
import {
  ClientConnectionAPI, ErrorCodes, ErrorStatus, MessagePackage, ServiceAccess
} from '@container/models';
import { AuthPayload } from '../gateway/types';
import { EMPTY, fromEvent, timer } from 'rxjs';
import { auditLogger } from '../logger/AuditLogger';
import * as Bowser from 'bowser';
import config from 'config';
import { catchError, switchMap, take, takeUntil, takeWhile, tap, timeout } from 'rxjs/operators';
import { Socket } from 'socket.io';

export interface ServerClientInterface {
  active: boolean;
  virtual: boolean;
  data: any;
  auth: AuthPayload;
  grants: Array<ServiceAccess>;
  client: Client;
  id: string;
  ip: string;
  userAgentInfo: any;

  send(method: string | MessagePackage, data?: any, anyway?: boolean): void;
  sendError(code: number, message: any): void;
  close(code?: ErrorCodes, message?: string | { errno: number, message: string, stack?: string }): void;
}

/**
 * Register layer. Server use it to instantiate register client when has new connection.
 *
 * @class
 * @return {ServerClient}
 */
export class ServerClient implements ServerClientInterface {
  /**
   * @static {number} _index - use internals for ID generation
   */
  private static _index = 0;

  /**
   * Generate unique ID
   *
   * @static
   * @return {number}
   */
  private static get nextIndex(): number {
    this._index += 1;
    return this._index;
  }

  /**
   * @private {Client} _client - container for public access. Applications is it to work with connection
   */
  private _client: Client;

  /**
   * @private {string} _id - dynamic generate unique ID
   */
  private _id = 'default';

  private _params: any = {};
  private _grants: Array<ServiceAccess> = [];
  private _auth: AuthPayload;

  private sendPingTime: number;
  private recvPongTime: number;

  get virtual(): boolean {
    return !this.ws;
  }

  set data(p: any) {
    this._params = p;
  }

  get data(): any {
    return this._params;
  }

  set auth(value: AuthPayload) {
    this._auth = value;
  }

  get auth(): AuthPayload {
    return this._auth;
  }

  set grants(p: Array<ServiceAccess>) {
    this._grants = p;
  }

  get grants(): Array<ServiceAccess> {
    return this._grants;
  }
  /**
   * Get public access to connection
   *
   * @return {Client}
   */
  get client(): Client {
    return this._client;
  }

  /**
   * Get client ID
   *
   * @return {string}
   */
  get id(): string {
    return this._id;
  }

  get ip(): string {
    return this.req.ip || '0.0.0.0';
  }

  get userAgentInfo(): any {
    if (this.req.headers['user-agent']) {
      return Bowser.parse(this.req.headers['user-agent']);
    }
    return null;
  }

  public active = true;

  constructor(
    private req: any,
    private ws: WebSocket,
    private appAlias: string,
    private instAlias: string,
    kpInterval = true
  ) {
    if (!this.ws) {
      throw new Error('Connection is undefined');
    }

    this._id = ServerClient.nextIndex + '';
    this._client = new Client(this);

    const keepAliveInterval = config.get<number>('socketServerConfig.keepAliveInterval');

    if (keepAliveInterval && kpInterval && !!this.ws) {
      this.keepAliveEngine();
    }
  }

  private keepAliveEngine() {
    const keepAliveInterval = config.get<number>('socketServerConfig.keepAliveInterval') * 1000;

    return timer(keepAliveInterval).pipe(
      takeWhile(() => {
        return !(this.ws.readyState !== WebSocket.OPEN);
      }),
      tap(() => {
        this.sendPingTime = Date.now();
        this.ws.ping('ping');

        //  browsers haven't api for ping/pong so we send a special message
        if (this.req.headers['user-agent']) {
          this.ws.send(`PING_OPCODE:${0x9}`);
        }
      }),
      switchMap(() => fromEvent(this.ws, 'pong').pipe(
        timeout(config.get<number>('socketServerConfig.keepAliveTimeout') * 1000),
        take(1),
      )),
      takeUntil(
        fromEvent(this.ws, 'close')
      ),
      catchError(() => {
        this.ws.close();
        this.ws.emit('close', 1011);

        apm.captureError('Remote client does not respond pong. Timeout was emitted', {
          custom: this.data
        });
        return EMPTY;
      }),
    ).subscribe(() => {
      this.recvPongTime = Date.now();
      // console.log('------------------------>>> RECV PONG',  this.recvPongTime - this.sendPingTime);

      this.keepAliveEngine();
    });
  }

  /**
   * Send message
   *
   * @param {string} method - public remote method name
   * @param {any} data - any valid JSON object (string, number, literal)
   */
  send(method: string | MessagePackage, data: any = '', anyway = false) {
    if (this.active || anyway) {
      this._sendMessage(method, data);
    }
  }

  /**
   * Send to special public remote method ClientConnectionAPI.ERROR
   *
   * @param {number} code - error code
   * @param {any} message - any valid JSON object (string, number, literal)
   */
  sendError(code: number, message: any) {
    this._sendMessage(ClientConnectionAPI.ERROR, new ErrorStatus('', JSON.stringify(message), code));
  }

  /**
   * Send message to special remote method ClientConnectionAPI.ERROR and force connection close.
   *
   * @see {sendError}
   * @param {number} code
   * @param {any} message
   */
  close(code: ErrorCodes = 0, message: string | { errno: number, message: string, stack?: string } = '') {
    if (!!this.ws) {
      if (code) {
        this.sendError(code, message);
      }
      this.ws.close();
    }
  }

  private _sendMessage(method: string | MessagePackage, data: any = '') {
    if (!!this.ws && this.ws.readyState === WebSocket.OPEN) {
      let pm: MessagePackage;

      if (method instanceof MessagePackage) {
        pm = method;
      } else {
        pm = new MessagePackage(method, data);
      }

      const messageString = MessagePackage.stringify(pm);

      if (pm.method !== ClientConnectionAPI.SERVER_TIME) {
        auditLogger.info(`Outgoing message from ${this.appAlias}.${this.instAlias} to ${this._client.data.aid} - method: ${pm.method}, length: ${messageString.length}`);
      }

      try {
        this.ws.send(messageString);
      } catch (err) {
        apm.captureError(err);
      }
    }
  }
}

export class ServerSocketIoClient implements ServerClientInterface {
  private _client: Client;
  private _auth: AuthPayload;
  private _data = {};

  grants: ServiceAccess[] = [];

  get virtual(): boolean {
    return !this.ws;
  }

  set data(p: any) {
    this._data = p;
  }

  get data(): any {
    return this._data;
  }

  set auth(value: AuthPayload) {
    this._auth = value;
  }

  get auth(): AuthPayload {
    return this._auth;
  }

  get client(): Client {
    return this._client;
  }

  get id(): string {
    return this.ws.id;
  }

  get ip(): string {
    return this.req.ip || '0.0.0.0';
  }

  get userAgentInfo(): any {
    if (this.req.headers['user-agent']) {
      return Bowser.parse(this.req.headers['user-agent']);
    }
    return null;
  }

  public active = true;

  constructor(
    private req: any,
    private ws: Socket,
    private appAlias: string,
    private instAlias: string
  ) {
    if (!this.ws) {
      throw new Error('Connection is undefined');
    }

    this._client = new Client(this);
    this._data = this.ws.handshake.query;
  }

  send(method: string | MessagePackage, data: any = '', force = false) {
    if (this.active || force) {
      this._sendMessage(method, data);
    }
  }

  sendError(code: number, message: any) {
    this._sendMessage(ClientConnectionAPI.ERROR, new ErrorStatus('', JSON.stringify(message), code));
  }

  close(code: ErrorCodes = 0, message: string | { errno: number, message: string, stack?: string } = '') {
    if (!!this.ws) {
      if (code) {
        this.sendError(code, message);
      }
      this.ws.disconnect();
    }
  }

  private _sendMessage(method: string | MessagePackage, data: any = '') {
    if (!!this.ws && this.ws.connected) {
      let pm: MessagePackage;

      if (method instanceof MessagePackage) {
        pm = method;
      } else {
        pm = new MessagePackage(method, data);
      }

      if (pm.method !== ClientConnectionAPI.SERVER_TIME) {
        auditLogger.info(`Outgoing message from ${this.appAlias}.${this.instAlias} to ${this._client.data.aid} - method: ${pm.method}`);
      }

      try {
        this.ws.send(pm);
      } catch (err) {
        apm.captureError(err);
      }
    }
  }
}
