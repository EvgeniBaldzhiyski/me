import { Attendee, Roles, UpdateMessageData } from '@container/models';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import Meeting from '../Meeting';
import BaseModule from './BaseModule';
import Client from '../../../utils/Client';

export default class BatonEngine extends BaseModule {
  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  public setupBaton(roomid: string) {
    const packages = [];
    const attendees = this.inst.attendeeStorage.getAttendees();

    for (const [_, attendee] of attendees) {
      if (attendee.room !== roomid || attendee.left) {
        continue;
      }

      if ( attendee.hasBaton === false && (
        attendee.role === Roles.LEAD || attendee.role === Roles.COHOST || attendee.role === Roles.HOST
      )) {
        packages.push(new UpdateMessageData(attendee.id, 'hasBaton', true));
      }

      if (
        attendee.hasBaton === true &&
        attendee.role !== Roles.LEAD &&
        attendee.role !== Roles.HOST &&
        attendee.role !== Roles.COHOST
      ) {
        packages.push(new UpdateMessageData(attendee.id, 'hasBaton', false));
      }
    }

    if (packages.length) {
      this.inst.updateEngine.updateAttendees(null, packages);
    }
  }

  // @TODO - have to make setupBaton private and move all baton support here
  // @TODO - (detection for update Attendee.left, Attendee.room, ...)
  @ApmSpan()
  async approveAttendeeChange(client: Client | null, id, data, done) {
    const a: Attendee | undefined = this.inst.model.attendeesIndex[id];

    if (data.room !== undefined) {
      data.hasBaton = false;
    }

    if (data.role !== undefined && (data.role === Roles.COHOST || data.role === Roles.LEAD)) {
      data.hasBaton = true;
    }

    if (a) {
      if (a.role === Roles.HOST || a.role === Roles.COHOST || a.role === Roles.LEAD) {
        delete data.hasBaton;

        if (!a.hasBaton) {
          data.hasBaton = true;
        }
      }
      if (a.role === Roles.PHONE && a.hasBaton) {
        data.hasBaton = false;
      }
    }

    await done(data);

    if (data.role !== undefined) {
      if (a) {
        this.setupBaton(a.room);
      }
    }
  }
}
