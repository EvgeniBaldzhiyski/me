import BaseModule from '../../modules/BaseModule';
import { Attendee, ClientConnectionAPI, ErrorCodes, Room, StatActions, StatTypes } from '@container/models';
import { AttendeeJoinSuccessEvent } from '../../events/SessionEvents';

// TODO: see if we can use the standard aws-sdk, and the client build not break
// currently (2019-04-17) adding @types/node leads to a building error in the docker containre:
// ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
// import * as AWS from 'aws-sdk';

export interface StatDto {
  type: StatTypes;
  action: StatActions;
  id: string;
  info: string;
}

export default class StatisticsEngine extends BaseModule {
  private attendeeProvider: Map<Room['id'], Attendee> = new Map();
  private sendBuffer: Map<Room['id'], StatDto[]> = new Map();

  async setup() {
    await super.setup();

    this.inst.updateEngine.registerApprover(this);
    this.inst.eventBus.on(AttendeeJoinSuccessEvent.type, (attendee: Attendee) => this.onAttendeeJoin(attendee));
  }

  async destruct(code?: ErrorCodes) {
    this.attendeeProvider = null;

    return super.destruct(code);
  }

  async approveAttendeeChange(_, id, data, done) {
    const attendee = this.inst.model.attendeesIndex[id];

    if (!attendee) {
      return done(data);
    }

    const oldRid = attendee.room;

    await done(data);

    const affectedRooms = new Set<Room['id']>();

    if (data.left) {
      affectedRooms.add(attendee.room);
    }

    if (data.room !== undefined) {
      affectedRooms.add(data.room);
      affectedRooms.add(oldRid);
    }

    for (const rid of affectedRooms.values()) {
      const provider = this.attendeeProvider.get(rid);

      if (!provider || provider.id === id) {
        this.findAttendeeProvider(rid);
      }
    }
  }

  send(rid: Room['id'], type: StatTypes, action: StatActions, id: string = '', info: string = '') {
    const dto = {type, action, id, info} as StatDto;
    const provider = this.attendeeProvider.get(rid);

    if (provider) {
      this.inst.sendToAttendee(provider.id, ClientConnectionAPI.SEND_STATISTIC, dto);
    } else {
      const buffer = this.sendBuffer.get(rid) || [];
      this.sendBuffer.set(rid, buffer.push(dto) && buffer);
    }
  }

  private findAttendeeProvider(rid: Room['id']) {
    this.attendeeProvider.delete(rid);

    for (const attendee of Object.values(this.inst.model.attendeesIndex)) {
      if (!attendee.left && attendee.room === rid && !attendee.isGhost) {
        this.attendeeProvider.set(rid, attendee);

        const buffer = this.sendBuffer.get(rid) || [];

        for (const dto of buffer) {
          this.send(rid, dto.type, dto.action, dto.id, dto.info);
        }

        this.sendBuffer.delete(rid);
        return;
      }
    }
  }

  private onAttendeeJoin(attendee: Attendee) {
    const provider = this.attendeeProvider.get(attendee.room);

    if (!provider) {
      this.findAttendeeProvider(attendee.room);
    }
  }
}
