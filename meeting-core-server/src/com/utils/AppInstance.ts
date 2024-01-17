import {ServerClientInterface} from './ServerClient';
import Client from './Client';
import { ApplicationInterface } from './Application';
import { v4 } from 'uuid';
import { MessagePackage } from '@container/models';

class ReadonlyMap<K, V> extends Map {
  constructor(private secId: string) {
    super();
  }
  clear(): void { throw new Error('readonly map'); };
  delete(key: K): boolean { throw new Error('readonly map'); };
  set(key: K, value: V): this { throw new Error('readonly map'); };

  _clear(secId: string): void {
    if (secId !== this.secId) {
      throw new Error('readonly map');
    }
    return super.clear();
  };

  _delete(secId: string, key: K): boolean {
    if (secId !== this.secId) {
      throw new Error('readonly map');
    }
    return super.delete(key);
  };

  _set(secId: string, key: K, value: V): this {
    if (secId !== this.secId) {
      throw new Error('readonly map');
    }
    return super.set(key, value);
  };
}


export default class AppInstance<T extends ApplicationInterface = ApplicationInterface> {
  public app: T;
  public get: Record<string, Function> = {};
  public post: Record<string, Function> = {};
  public socket: Record<string, Function> = {};
  public message: Record<string, ((message: {
    data: any,
    id: string,
    appdata?: {
      type: string,
      name: string
    }
  }) => void)[]> = {};
  public shutdownTimer: NodeJS.Timer;

  readonly clients: ReadonlyMap<Client['id'], Client>;

  private _clients: Map<ServerClientInterface['id'], ServerClientInterface> = new Map();
  private secId = v4();

  constructor(private _id: string) {
    this.clients = new ReadonlyMap(this.secId);
  }

  public addClient(client: ServerClientInterface) {
    this.clients._set(this.secId, client.id, client.client);
    this._clients.set(client.id, client);
  }

  public getClient(id: string): ServerClientInterface {
    return this._clients.get(id) || null;
  }

  public removeClient(id: string): boolean {
    this.clients._delete(this.secId, id);
    return this._clients.delete(id);
  }

  public sendTo(method: string, data: any = '', ids?: string[] | string | Set<string> | null, anyway = false) {
    if (ids === null) {
      return;
    }

    const mp = new MessagePackage(method, data);

    if (ids === undefined) {
      for (const [, client] of this._clients) {
        client.send(mp, undefined, anyway);
      }
      return;
    }

    if (typeof ids === 'string') {
      this._clients.get(ids)?.send(mp);

      return;
    }

    for (const id of ids) {
      const cln = this._clients.get(id);

      if (cln) {
        cln.send(mp, undefined, anyway);
      }
    }
  }

  public get id(): string {
    return this._id;
  }

  public get clientsLength(): number {
    return this.clients.size;
  }
}

export enum AppInstanceMessagingEvents {
  INIT = 'applicationMessagingInit',
  SHUTDOWN = 'ApplicationMessagingShutdown',
  BEFORE_SHUTDOWN = 'ApplicationMessagingBeforeShutdown'
}
