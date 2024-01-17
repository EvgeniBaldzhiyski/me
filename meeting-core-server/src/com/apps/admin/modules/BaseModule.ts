import Admin from '../Admin';
import Client from '../../../utils/Client';
import { Attendee, AttendeeBase, ServiceAccess } from '@container/models';
import { ServerRequest, ServerResponse } from '../../../utils/Server';
import { ApmTransaction, TransactionType } from '@container/apm-utils';
import { gatewayScanner } from '../../../gateway/manager';

export interface BaseModuleInterface {
  getId(): ServiceAccess;

  setup();
  destruct();
  beforeDestruct();

  onUpdateAttendee(id: string, data: AttendeeBase);
  onAddAttendee(a: Attendee);
  onRemoveAttendee(id: string);

  onConnect(client: Client);
  // temp force param to deal with disconnection issues
  onDisconnect(client: Client, force?: boolean);

  onSocket(name, handler: (client: Client, data) => void);
  onPost(name: string, handler: (req, res, params, grants: ServiceAccess[]) => void);
  onGet(name: string, handler: (req, res, params, grants: ServiceAccess[]) => void);
  sendTo(method: string, data: any, ids?: string[] | string);
}

export type BaseModuleCtor = new(inst: Admin, id: ServiceAccess) => BaseModuleInterface;

export default abstract class BaseModule implements BaseModuleInterface {
  constructor(
    protected inst: Admin,
    protected id: ServiceAccess
  ) {
    gatewayScanner(this, this.inst.server, [ this.inst ]);
  }

  getId(): ServiceAccess {
    return this.id;
  }

  onSocket(name, handler: (client: Client, data) => void) {
    this.inst.server.onSocket(name, (client: Client, data) => {
      if (client.grants.indexOf(this.id) === -1) {
        return;
      }
      handler.call(this, client, data);
    });
  }
  onPost(name: string, handler: (req: ServerRequest, res: ServerResponse, params, grants: ServiceAccess[]) => void) {
    this.inst.server.onPost(name, (req, res, params, grants) => {
      if (grants.indexOf(this.id) === -1) {
        return;
      }
      handler.call(this, req, res, params, grants);
    });
  }
  onGet(name: string, handler: (req: ServerRequest, res: ServerResponse, params, grants: ServiceAccess[]) => void) {
    this.inst.server.onGet(name, (req, res, params, grants) => {
      if (grants.indexOf(this.id) === -1) {
        return;
      }
      handler.call(this, req, res, params, grants);
    });
  }

  sendTo(method: string, data: any = '', ids?: string[] | string | Set<Client['id']>) {
    if (typeof ids === 'string') {
      const client = this.inst.server.clients.get(ids);

      if (client) {
        this.inst.server.sendTo(method, data, client.id);
      }
      return;
    }

    if (ids === undefined) {
      ids = this.inst.server.clients as undefined;
    }

    const _ids = [];

    for (const [id] of ids) {
      const client = this.inst.server.clients.get(id);

      if (client?.grants.indexOf(this.id) !== -1) {
        _ids.push(id);
      }
    }

    this.inst.server.sendTo(method, data, _ids);
  }

  setup() { }
  destruct() {
    this.inst = null;
  }
  beforeDestruct() { }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onConnect(client: Client) { }
  @ApmTransaction(TransactionType.WS_REQUEST)
  onDisconnect(client: Client) { }

  onUpdateAttendee(id: string, data: AttendeeBase) { }
  onAddAttendee(a: Attendee) { }
  onRemoveAttendee(id: string) { }
}
