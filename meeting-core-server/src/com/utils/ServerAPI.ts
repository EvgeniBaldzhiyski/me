import Server from './Server';
import Client from './Client';
import { ErrorCodes } from '@container/models';
import { IncomingMessage } from 'http';

export default class ServerAPI {
  constructor(
    protected appID: string,
    protected readonly server: Server
  ) { }

  public onGet(name: string, handler: Function) {
    return this.server.onGet(this.appID, name, handler);
  }

  public onPost(name: string, handler: Function) {
    return this.server.onPost(this.appID, name, handler);
  }

  public onSocket(name: string, handler: (client: Client, data: any, req?: IncomingMessage, authPayload?: any) => void) {
    return this.server.onSocket(this.appID, name, handler);
  }

  public onMessage(name: string, handler: (message: {
    data: any,
    command: string,
    source?: {
      type: string,
      name: string
    }
  }) => void) {
    return this.server.onMessage(this.appID, name, handler);
  }

  public async disconnect(ids: string[] | string, code: number = 0, message: string = '') {
    return this.server.disconnect(this.appID, ids, code, message);
  }

  public async sendTo(method: string, data: any = '', ids?: string[] | string | Set<string> | null, anyway = false) {
    return this.server.sendTo(this.appID, method, data, ids, anyway);
  }
  public sendMessage(command: string, data: any) {
    return this.server.sendMessage(this.appID, command, data);
  }

  public get clients(): Map<Client['id'], Client> {
    return this.server.getClients(this.appID);
  }

  public get clientsLength(): number {
    return this.server.getClientsLength(this.appID);
  }

  public async shutdown(timer = 0, code = ErrorCodes.KILL) {
    if (timer) {
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            resolve(await this.server.shutdownInst(this.appID, true, code));
          } catch (e) {
            reject(e);
          }
        }, (timer * 1000));
      });

    } else {
      return this.server.shutdownInst(this.appID, true, code);
    }
  }
}
