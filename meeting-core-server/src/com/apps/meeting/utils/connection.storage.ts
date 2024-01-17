import { Attendee } from '@container/models';
import Client, { ClientState } from '../../../utils/Client';
import Meeting from '../Meeting';

export class ConnectionStorage {
  private attendeeMap = new Map<Attendee['id'], Client['id']>();
  private clientMap = new Map<Client['id'], Attendee['id']>();

  constructor(private inst: Meeting) { }

  destruct() {
    this.attendeeMap.clear();
    this.clientMap.clear();
  }

  addUpdateConnection(aid: Attendee['id'], cid: Client['id']) {
    if (this.attendeeMap.get(aid)) {
      this.removeConnection(aid);
    }

    this.attendeeMap.set(aid, cid);
    this.clientMap.set(cid, aid);
  }

  removeConnection(id: Client['id'] | Attendee['id']) {
    const cid = this.getClientId(id);

    if (cid) {
      this.clientMap.delete(cid);
      this.attendeeMap.delete(id);

      return;
    }

    const aid = this.getAttendeeId(id);

    if (aid) {
      this.attendeeMap.delete(aid);
      this.clientMap.delete(id);
    }
  }

  getAttendeeId(cid: Client['id']): Attendee['id'] | undefined {
    return this.clientMap.get(cid);
  }

  getClientId(aid: Attendee['id']): Client['id'] | undefined {
    return this.attendeeMap.get(aid);
  }

  hasAttendeeConnection(aid: Attendee['id']): boolean {
    return this.inst.server.clients.has(this.getClientId(aid));
  }

  getAttendeeConnection(aid: Attendee['id']): Client | undefined {
    return this.inst.server.clients.get(this.getClientId(aid));
  }

  isAttConnBlocked(aid: Attendee['id']) {
    const client = this.getAttendeeConnection(aid);

    return client.state !== ClientState.ACTIVE;
  }
}
