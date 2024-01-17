// process.env.DEBUG="*"

import apm from 'elastic-apm-node/start';
import restify from 'restify';
import WebSocket from 'ws';
import Client from './Client';
import ServerAPI from './ServerAPI';
import AppInstance from './AppInstance';
import ServerConfig from './ServerConfig';
import serverConfig from '../utils/serverConfig';
import { clearTimeout, setTimeout } from 'timers';
import { ApplicationInterface, ApplicationInterfaceCtor, ApplicationLifeCycleState } from './Application';
import { Logger } from 'winston';
import { ErrorCodes } from '@container/models';
import { createDefaultLogger } from '../logger/DefaultLogger';
import { IncomingMessage } from 'http';
import { mongoClient } from '../database';
import { ApmTransaction, TransactionType } from '@container/apm-utils';
import { webSocketInput, socketIoInput } from './server-ws-input';
import { httpInput } from './server-http-input';
import { BehaviorSubject } from 'rxjs';
import { terminateKafka } from './kafka-publisher';

import { Server as SocketIO, Socket } from 'socket.io';
import config from 'config';
import { trustProxy } from '../../plugins/trust-proxy';

/**
 * Core class. Open http and socket gateway on same port.
 *
 * @class
 * @export {Server}
 */
export default class Server {
  /**
   * @private {WebSocket.Server} socket - socket server engine
   * @see https://github.com/websockets/ws/blob/master/doc/ws.md#class-websocketserver
   */
  protected socketServer: SocketIO;
  protected legacySocketServer: WebSocket.Server;

  /**
   * @private {Restify.Server} rest - web server engine
   * @see http://restify.com/docs/server-api/#server
   */
  protected rest: restify.Server;

  private apps = {} as Record</* appAlias as */ string, AppItem>;

  private insts = {} as Record</* appInstanceID as */ string, AppInstance>;

  private _logger: Logger;
  /**
   *
   * @param {ServerConfig } [conf=new ServerConfig] - server configuration
   */

  private connectionCountSubject = new BehaviorSubject(0);

  public connectionCount$ = this.connectionCountSubject.asObservable();

  private allowedInstances = new Set();

  constructor(public conf: ServerConfig = new ServerConfig) {
    this.setup();
  }

  // ----- PUBLIC Main

  public addAllowedInstance(instId) {
    this.allowedInstances.add(instId);
  }

  public removeAllowedInstance(instId) {
    this.allowedInstances.delete(instId);
  }

  public hasAllowedInstance(instId) {
    return this.allowedInstances.has(instId);
  }

  public getInsts() {
    return this.insts;
  }

  public getAppInstanceById(id): AppInstance | null {
    return this.insts[id] || null;
  }

  public getAppInstanceByName(appName: string, instName: string): AppInstance | null {
    const id = this.getAppInstanceId(appName, instName);

    return this.getAppInstanceById(id);
  }

  public getAppInstanceId(appName: string, instName: string): string {
    return `${appName}.${instName}`;
  }

  get logger(): Logger {
    return this._logger;
  }

  /**
   * Register application. The connection will fail if try to use unregister application.
   *
   * @param {string} appAlias - register name of application
   * @param {ApplicationInterfaceCtor} clsCtor - application class. Server will use it when builds instances
   * @param {object} [config={}] - Application configuration. Server sends it like param when the instance is built
   * @param {string} [defname=_default_] - name of default instance
   * @param {boolean} [initDef=false] - initial definition
   */
  public addApp(
    appAlias: string,
    clsCtor: ApplicationInterfaceCtor,
    config: any = {},
    options: {
      defname?: string;
      dependsOn?: string[];
      autoStart?: boolean;
      limited?: boolean;
    } = {}
  ): void {
    this.apps[appAlias] = {
      clsCtor,
      conf: config,
      defname: options.defname || '_default_',
      dependsOn: options.dependsOn,
      autoStart: !!options.autoStart,
      limited: !!options.limited
    };
  }

  public hasApp(appAlias: string): boolean {
    return !!this.apps[appAlias];
  }

  public getApp(appAlias: string): AppItem | null {
    return this.apps[appAlias] || null;
  }

  public async shutdownInst(appInstanceID: string, force: boolean = false, code = ErrorCodes.KILL) {
    const appInstance = this.insts[appInstanceID];
    if (appInstance) {
      const time = this.conf.instShutdownTimer * 1000;

      if (force) {
        return await this._shutdownInst(appInstanceID, code);
      } else {
        // TODO: Watch out for memory leaks due to unresolved promises, handle this using RxJS Observables in future!
        return new Promise(async (resolve, reject) => {
          try {
            clearTimeout(appInstance.shutdownTimer);
            appInstance.shutdownTimer = setTimeout(
              async () => {
                resolve(await this._shutdownInst(appInstanceID, code));
              },
              time
            );
            this._logger.debug('Server Application instance (' + appInstanceID + ') has been added for shutdown in (' + (time / 1000 / 60) + ') minutes');
          } catch (e) {
            reject(e);
          }
        });
      }
    }
  }

  // ------ PUBLIC ServerAPI

  public onGet(appInstanceID: string, name: string, handler: Function) {
    this.insts[appInstanceID].get[name] = handler;
  }

  public onPost(appInstanceID: string, name: string, handler: Function) {
    this.insts[appInstanceID].post[name] = handler;
  }

  public onSocket(
    appInstanceID: string,
    name: string,
    handler: (
      client: Client,
      data: any,
      req?: IncomingMessage,
      authPayload?: any
    ) => void
  ) {
    this.insts[appInstanceID].socket[name] = handler;
  }

  public onMessage(
    appInstanceID: string,
    name: string,
    handler: (data: any, appdata?: { type: string, name: string}) => Promise<void> | void
  ) {
    this.insts[appInstanceID].message[name] = (this.insts[appInstanceID].message[name] || []).concat(handler);
  }

  public async disconnect(appInstanceID: string, ids: Array<string> | string, code: number = 0, message: string = '') {
    const arr = typeof ids == 'string' ? [ids] : ids;
    return Promise.allSettled(
      arr.map(async (id) => {
        const client = this.insts[appInstanceID].getClient(id);
        this.insts[appInstanceID].removeClient(id);

        if (client) {
          return client.close(code, message);
        }
        return Promise.resolve();
      })
    );
  }

  public async sendTo(appInstanceID: string, method: string, data: any = '', ids?: string[] | string | Set<string> | null, anyway = false) {
    return this.insts[appInstanceID]?.sendTo(method, data, ids, anyway);
  }

  public sendMessage(appInstanceID: string, command: string, data: any) {
    const appInstance = this.insts[appInstanceID];
    let source;

    if (appInstance) {
      source = {
        type: appInstance.app.type,
        name: appInstance.app.name
      };
    }

    Object.values(this.insts).forEach(_inst_ => {
      if (!_inst_.app.isActive()) {
        return;
      }

      [_inst_.message['*'], _inst_.message[command]].filter(f => !!f)
        .forEach(handlersArray => handlersArray.forEach(
          handler => handler.call(_inst_, { command, data, source })
        ));
    });
  }

  public getClients(appInstanceID: string): Map<Client['id'], Client> {
    return this.insts[appInstanceID]?.clients || new Map();
  }

  public getClientsLength(appInstanceID: string): number {
    return this.insts[appInstanceID]?.clientsLength;
  }

  public async shutdown() {
    await Promise.allSettled([
      new Promise<void>(resolve => {
        this._logger.info(`Closing http server... Inflight requests: ${this.rest.inflightRequests()}`);
        this.rest.close(() => {
          this._logger.info(`Http server closed.`);
          resolve();
        });
      }),
      new Promise<void>((resolve, reject) => {
        const size = this.socketServer.of('/').adapter.sids.size + (this.legacySocketServer?.clients.size || 0);
        this._logger.info(
          `Closing socket server... Active socket connections: ${size}`
        );
        this.legacySocketServer?.close();
        this.socketServer.close((err) => {
          if (err) {
            this._logger.warn(`Error while closing socket server: ${err.message}`);
            return reject();
          }
          this._logger.info(`Socket server closed.`);
          resolve();
        });
      }),
      ...Object.keys(this.insts).map(async (appID) => {
        try {
          return await this._shutdownInst(appID, ErrorCodes.SERVER_RESTART, 'Server restarting...');
        } catch (e) {
          apm.captureError(e);
          this._logger.error(`Server trying to shutdown Application: "${appID}", got error. ${e.message}`);
          throw e;
        }
      })
    ]);
    await Promise.allSettled([
      terminateKafka(),
      mongoClient.close()
        .then(() => this.logger.info('Mongo client closed successfully.'))
        .catch(e => {
          apm.captureError(e);
          this.logger.error(`Failed to close Mongo client. ${e.message}`);
        })
    ]);
  }

  /**
   * For internal usage. It keeps the constructor clean.
   *
   * @protected
   * @returns {void}
   */
  protected setup() {
    this._logger = createDefaultLogger('server', this.conf.name + this.conf.port);

    this.setupRest();
    this.setupSocket();
  }
  /**
   * Instantiates http engine and register request parser.
   * Url map: https://<server.domain>:<port>/<Application name>/<Instance name>/<public method name>/[?<parameters(UrlQuery string)>]
   * if any of <Application name>, <Instance name> or <public method name> is not available will be responded with error 404.
   *
   * @protected
   * @returns {void}
   */
  protected setupRest() {
    this._logger.info(`Setting up REST server...`);
    this.rest = restify.createServer({ name: this.conf.name, handleUpgrades: true });

    this.rest.use(trustProxy());
    this.rest.use(restify.plugins.queryParser({ mapParams: true }));
    this.rest.use(restify.plugins.bodyParser({ mapParams: true }));

    // if catch error just will stop with standard response
    this.rest.on('restifyError', (req, res, err, next) => {
      apm.captureError(err);
      this._logger.error(err.message);

      res.send(ErrorCodes.BAD_PARAMS, {
        errno: ErrorCodes.BAD_PARAMS,
        message: 'Bad Request',
        code: err.restCode
      });

      // next()
    });

    this.rest.get('/check', (req, res, next) => this.healthCheck(req, res, next));
    this.rest.get('/favicon.ico', (req, res, next) => this.onFavicon(req, res, next));

    this.rest.head('*', (req, res, next) => this.onHead(req, res, next));

    // @deprecated obsolete
    // this.rest.opts('*', (req, res, next) => this.httpInput(req, res, 'opts', next));
    this.rest.get('*', (req, res, next) => this.httpInput(req, res, 'get', next));
    this.rest.post('*', (req, res, next) => this.httpInput(req, res, 'post', next));

    this.rest.on('MethodNotAllowed', (req, res, next) => this.onMethodNotAllowed(req, res));
    this.rest.on('NotFound', (req, res, next) => this.onNotFound(req, res));

    this.rest.listen(this.conf.port, (err) => {
      if (err) {
        apm.captureError(err);
        this._logger.error(err.message);
      } else {
        this._logger.info(`Server ${this.conf.name} is listening on ${this.conf.port}`);

        this._logger.debug('Global configuration: ', serverConfig.CONFIG);

        for (const type in this.apps) {
          const app = this.getApp(type);

          if (app.autoStart) {
            this.ensureInstance(type, app.defname);
          }
        }
      }
    });
  }

  protected healthCheck(req: ServerRequest, res: ServerResponse, next) {
    res.send(200, { status: 'UP' });
  }
  protected onMethodNotAllowed(req: ServerRequest, res: ServerResponse) {
    this.logger.debug(`MethodNotAllowed ${req.method} ${req.url}`, {headers: req.headers});
    res.send(405);
  }
  protected onNotFound(req: ServerRequest, res: ServerResponse) {
    this.logger.debug(`onNotFound ${req.method} ${req.url}`, {headers: req.headers});
    res.send(404);
  }
  protected onFavicon(req: ServerRequest, res: ServerResponse, next) {
    res.send(200);
  }
  protected onHead(req: ServerRequest, res: ServerResponse, next) {
    res.send(200);
  }

  @ApmTransaction(TransactionType.REQUEST)
  protected httpInput(req: ServerRequest & {ip?: string, _upgradeRequest?: boolean},
                      res: ServerResponse & {_upgrade?: {socket: any, head: any}},
                      method: 'get' | 'post',
                      next) {

    if (req._upgradeRequest) {
      this.rest.emit('upgrade', req, res._upgrade.socket, res._upgrade.head);
      return next();
    }
    httpInput(this, req, res, method, next);
  }

  protected setupSocket() {
    this.legacySocketServer = new WebSocket.Server({
      noServer: true,
      clientTracking: false,
      maxPayload: 1000000
    });
    // legacy clients gateway
    this.rest.on('upgrade', (req, socket, head) => {
      if (req.url.indexOf('/socket.io') === 0) {
        return;
      }

      this.logger.debug(`New legacy client, URL: ${req.url}`);

      this.legacySocketServer.handleUpgrade(req, socket, head, websocket => {
        this.connectionCounter(websocket);
        webSocketInput(this, websocket, req);
      });
    });

    this.socketServer = new SocketIO(this.rest.server, {
      pingInterval: config.get<number>('socketServerConfig.keepAliveInterval') * 1000,
      pingTimeout: config.get<number>('socketServerConfig.keepAliveTimeout') * 1000
    });
    this.socketServer.of(/^\/.+$/).use((socket: Socket, next) => {
      this.connectionCounter(socket);
      socketIoInput(this, socket, socket.request);
      next();
    });
  }

  private connectionCounter(connection: WebSocket | Socket) {
    this.connectionCountSubject.next(this.connectionCountSubject.value + 1);

    connection.once('close', _ => {
      this.connectionCountSubject.next(this.connectionCountSubject.value - 1);
    });
    connection.once('disconnect', () => {
      this.connectionCountSubject.next(this.connectionCountSubject.value - 1);
    });
  }

  public async ensureInstance(appAlias: string, instAlias: string): Promise<AppInstance<ApplicationInterface>> {
    let appInstance = this.getAppInstanceByName(appAlias, instAlias);

    if (!appInstance) {
      appInstance = await this.bootInstance(appAlias, instAlias);
    } else {  // clear idle shutdown timer
      if (appInstance.app.lifeCycleState !== ApplicationLifeCycleState.BROKEN && appInstance.shutdownTimer) {
        this._logger.debug(`Server Application instance (${appInstance.id}) has been removed from shutdown timer`);
        clearTimeout(appInstance.shutdownTimer);
        appInstance.shutdownTimer = null;
      }
    }

    return appInstance;
  }

  public async shutdownInstance(
    appAlias: string,
    instID: string,
    errCode?: ErrorCodes,
    errMessage?: string
  ) {
    const appInstanceID = this.getAppInstanceId(appAlias, instID);
    const appInstance = this.insts[appInstanceID];
    if (!appInstance) {
      return;
    }

    await this._shutdownInst(this.getAppInstanceId(appAlias, instID), errCode, errMessage);
  }

  @ApmTransaction('lifeCycleState')
  async bootInstance(appAlias: string, instID: string) {
    // Instantiates new instance
    const appInstanceID = this.getAppInstanceId(appAlias, instID);

    this.insts[appInstanceID] = new AppInstance(appInstanceID);

    try {
      let span = apm.startSpan(`${appInstanceID}.constructor`);

      this.insts[appInstanceID].app = new (this.apps[appAlias].clsCtor)(
        appAlias,
        instID,
        new ServerAPI(appInstanceID, this),
        createDefaultLogger(appAlias, instID),
        this.apps[appAlias].conf
      );
      span?.end();

      span = apm.startSpan(`${appInstanceID}.beforeSetup`);
      await this.insts[appInstanceID].app.beforeSetup();
      span?.end();

      span = apm.startSpan(`${appInstanceID}.setup`);
      await this.insts[appInstanceID].app.setup();
      span?.end();

      span = apm.startSpan(`${this.insts[appInstanceID].constructor.name}.trigger(ServerEventType.INST_ADD)`);
      span?.end();

      this._logger.info(`Server Application instance (${appInstanceID}) has been created`);

      return this.insts[appInstanceID];
    } catch (err) {
      if (!this.insts[appInstanceID].app) {
        delete this.insts[appInstanceID];
      } else {
        this.insts[appInstanceID].app.lifeCycleState = ApplicationLifeCycleState.BROKEN;
      }
      this.shutdownInst(appInstanceID);

      apm.captureError(err);
      this._logger.error(`Server Application instance (${appInstanceID}) creation failed with error. ${err.message}`);
      throw err;
    }
  }

  @ApmTransaction('lifeCycleState')
  private async _shutdownInst(appInstanceID: string, code = ErrorCodes.KILL, codemsg = 'Shutdown') {
    const instance = this.getAppInstanceById(appInstanceID);

    if (!instance || instance.app.lifeCycleState > ApplicationLifeCycleState.RUNNING) {
      return;
    }

    clearTimeout(instance.shutdownTimer);

    instance.app.lifeCycleState = ApplicationLifeCycleState.SHUTTING_DOWN;

    const instType = instance.app.type;
    const instName = instance.app.name;
    const app = this.getApp(instType);

    if (app.dependsOn) {
      for (const dependence of app.dependsOn) {
        const dependAppInstanceID = this.getAppInstanceId(dependence, instName);

        if (!!this.getAppInstanceById(dependAppInstanceID)) {
          // start a shutting down in parallel with а parent app instance shutdown
          this._shutdownInst(dependAppInstanceID);
        }
      }
    }

    let span;

    span = apm.startSpan(`${appInstanceID}.beforeDestruct`);
    try {
      await instance.app.beforeDestruct(code);
    } catch (err) {
      apm.captureError(err);
      this._logger.error(`Server Application instance (${appInstanceID}) error when executing "beforeDestruct". ${err.message}`);
    }
    span?.end();

    span = apm.startSpan(`${appInstanceID}.clients.disconnect`);
    try {
      const clientList = [];
      for (const [_, client] of instance.clients) {
        clientList.push(client.id);
      }
      await this.disconnect(appInstanceID, clientList, code, codemsg);
    } catch (err) {
      apm.captureError(err);
      this._logger.error(`Server Application instance (${appInstanceID}) error when executing "disconnect" for all ServerClients. ${err.message}`);
    }
    span?.end();

    span = apm.startSpan(`${appInstanceID}.destruct`);
    try {
      await instance.app.destruct(code);
    } catch (err) {
      apm.captureError(err);
      this._logger.error(`Server Application instance (${appInstanceID}) error when executing "destruct". ${err.message}`);
    }
    span?.end();

    this._logger.info(`Clearing up listeners for Application instance (${appInstanceID}).`);

    instance.get = {};
    instance.post = {};
    instance.socket = {};
    instance.message = {};
    
    this.removeAllowedInstance(appInstanceID);

    delete this.insts[appInstanceID];

    span = apm.startSpan(`${appInstanceID}.trigger(INST_REMOVE)`);
    this._logger.debug(`Server Application instance (${appInstanceID}) did shutdown`);
    span?.end();
  }
}

interface AppItem {
  clsCtor: ApplicationInterfaceCtor;
  conf?: any;
  defname?: string;
  dependsOn?: string[];
  autoStart?: boolean;
  limited: boolean;
}

export class ApiParserError extends Error {
  constructor(
    message: string,
    public code?: ErrorCodes,
    public isPrimary?: boolean
  ) {
    super(message);
  }
}

export type ServerRequest = restify.Request & {ip?: string};
export type ServerResponse = restify.Response;
