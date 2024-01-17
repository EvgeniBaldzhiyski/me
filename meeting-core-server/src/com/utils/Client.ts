import {ServerClientInterface} from './ServerClient';
import { ServiceAccess } from '@container/models';
import { AuthPayload } from '../gateway/types';

export enum ClientState {
  REJECTED = -2,
  PENDING = -1,
  INACTIVE = 0,
  ACTIVE = 1,
  WAITING_INIT = -3,
  WAITING_AUTH = -4,
}

/**
 * Public access to connect client. It is used of Applications
 *
 * @class
 * @export {Client}
 */
export default class Client {
  constructor(
    private server: ServerClientInterface
  ) { }

  private status: number = ClientState.ACTIVE;

  get virtual(): boolean {
    return this.server.virtual;
  }

  /**
   * Getter that give connection IP
   *
   * @return {string}
   */
  get ip(): string {
    return this.server.ip;
  }

  get userAgentInfo(): any {
    return this.server.userAgentInfo;
  }

  /**
   * Getter that give Client ID
   *
   * @return {ClientServer.id}
   */
  get id(): string {
    return this.server.id;
  }

  get data(): any {
    return this.server.data;
  }

  get grants(): Array<ServiceAccess> {
    return this.server.grants;
  }

  get auth(): AuthPayload | null {
    if (!this.server.auth) {
      return null;
    }

    return { ...this.server.auth } as AuthPayload;
  }

  get state(): ClientState {
    return this.status;
  }

  set state(value: ClientState) {
    this.status = value;
    this.server.active = (this.status > 0);
  }

  /**
   * 
   * @deprecated use ServerAPI.sendTo
   */
  send(method: string, data: any = '', anyway = false) {
    this.server.send(method, data, anyway);
  }
}
