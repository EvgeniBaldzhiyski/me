import ServerAPI from './ServerAPI';
import Client from './Client';
import { Logger } from 'winston';
import { ErrorCodes, MessagePackage } from '@container/models';
import { ApmTransaction, TransactionType } from '@container/apm-utils';
import { gatewayScanner } from '../gateway/manager';

export enum ApplicationLifeCycleState {
  IDLE = 0,
  BROKEN,
  INITIALIZING,
  RUNNING,
  SHUTTING_DOWN,
  SHUT_DOWN,
}

/**
 * Server use it when create instance
 *
 * @interface
 * @export {ApplicationClassInterface}
 */
export type ApplicationInterfaceCtor = new (
  type: string,
  name: string,
  server: ServerAPI,
  logger: Logger,
  config: object
) => ApplicationInterface;

/**
* Server use it when add application to register
*
* @interface
* @export {ApplicationInterface}
*/
export interface ApplicationInterface {
  lifeCycleState: ApplicationLifeCycleState;
  name: string;
  type: string;
  server: ServerAPI;
  logger: Logger;

  runId: string;

  isActive(): boolean;
  isClosed(): boolean;

  beforeSetup(): Promise<void>;
  setup(): Promise<void>;
  onConnect(client: Client): void;
  onDisconnect(client: Client): void;
  destruct(code?: ErrorCodes): Promise<void>;
  beforeDestruct(code?: ErrorCodes): Promise<void>;
  onSocketBefore(client: Client, pm: MessagePackage): boolean;
}

/**
 * Main class ot applications. Server use it to make (when first client is connected) AppInstances.
 *
 * @class
 * @abstract
 * @export {Application}
 */
export abstract class Application implements ApplicationInterface {
  private _lifeCycleState = ApplicationLifeCycleState.IDLE;

  constructor(
    public readonly type: string,
    public readonly name: string,
    public readonly server: ServerAPI,
    public readonly logger: Logger,
    protected _config = {}
  ) {
    gatewayScanner(this, this.server);
  }

  get lifeCycleState(): ApplicationLifeCycleState {
    return this._lifeCycleState;
  }

  set lifeCycleState(value: ApplicationLifeCycleState) {
    this.logger.info(`Application instance ${this.type}.${this.name} change the state ${this._lifeCycleState} -> ${value}`);
    this._lifeCycleState = value;
  }

  get runId() { return ''; }

  /**
   * Setup
   */
  async beforeSetup() {
    this.lifeCycleState = ApplicationLifeCycleState.INITIALIZING;
    return Promise.resolve();
  }

  /**
   * Setup
   */
  async setup() {
    this.lifeCycleState = ApplicationLifeCycleState.RUNNING;
    return Promise.resolve();
  }

  isActive(): boolean {
    return (
      this.lifeCycleState === ApplicationLifeCycleState.INITIALIZING ||
      this.lifeCycleState === ApplicationLifeCycleState.RUNNING
    );
  }

  isClosed(): boolean {
    return (
      this.lifeCycleState === ApplicationLifeCycleState.SHUTTING_DOWN ||
      this.lifeCycleState === ApplicationLifeCycleState.SHUT_DOWN
    );
  }

  conf(name: string): any {
    return this._config[name];
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onConnect(client: Client) { }

  /**
   * This is invoked when Client is disconnected
   *
   * @param {Client} client
   * @param force - will skip all checks and will trigger disconnection event handlers in order
   * for all services to properly shutdown. TEMPORARY.
   */
  @ApmTransaction(TransactionType.WS_REQUEST)
  onDisconnect(client: Client, force?: boolean) { }

  onSocketBefore(client: Client, pm: MessagePackage): boolean {
    return true;
  }

  /**
   * This is invoked before instance to be destroyed
   *
   * @param {number} code
   */
  async destruct(code?: ErrorCodes) {
    this.lifeCycleState = ApplicationLifeCycleState.SHUT_DOWN;
    delete (this as any).server;
    delete (this as any).logger;
    delete this._config;
    return Promise.resolve();
  }

  async beforeDestruct(code?: ErrorCodes) {
    this.lifeCycleState = ApplicationLifeCycleState.SHUTTING_DOWN;
    return Promise.resolve();
  }
}
