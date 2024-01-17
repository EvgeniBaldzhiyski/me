import { Attendee, Room, Roles, AttendeeBase } from '@container/models';
import Meeting from '../Meeting';

export class AttendeeStorage {
  // @todo consider to expose public readonly attendee objects
  private attendeeById = new Map<Attendee['id'], Attendee>();
  private attendeesByRoom = new Map<Room['id'], Map<Attendee['id'], Attendee>>();
  private attendeeByUserAccountId = new Map<Attendee['userAccountID'], Attendee>();
  private attendeeByPhoneAudio = new Map<Attendee['phoneAudio'], Attendee>();

  // experimental
  private attendeesByRole = new Map<Attendee['role'], Map<Attendee['id'], Attendee>>();

  constructor(private inst: Meeting) { }

  destruct() {
    this.inst.model.attendeesIndex = {};

    this.attendeeById.clear();
    this.attendeeByUserAccountId.clear();
    this.attendeesByRoom.clear();
    this.attendeesByRole.clear();
    this.attendeeByPhoneAudio.clear();
  }

  addAttendee(attendeeData: Attendee | AttendeeBase): Attendee {
    const attendee = new Attendee(attendeeData);

    if (this.attendeeById.get(attendee.id)) {
      this.removeAttendee(attendee.id);
    }

    return this._addAttendee(attendee);
  }

  private _addAttendee(attendee: Attendee): Attendee {
    this.inst.model.attendeesIndex[attendee.id] = attendee;

    this.attendeeById.set(attendee.id, attendee);
    this.attendeeByUserAccountId.set(attendee.userAccountID, attendee);
    this.attendeeByPhoneAudio.set(attendee.phoneAudio, attendee);

    const roomAttendees = this.getAttendeeMapByRoomId(attendee.room);
      (roomAttendees || new Map()).set(attendee.id, attendee);
    this.attendeesByRoom.set(attendee.room, roomAttendees);

    const attendeesByRole = this.getAttendeesByRole(attendee.role);
      (attendeesByRole || new Map()).set(attendee.id, attendee);
    this.attendeesByRole.set(attendee.role, attendeesByRole);

    return attendee;
  }

  removeAttendee(id: Attendee['id'] | Attendee['userAccountID']): boolean {
    const attendee = this.getAttendee(id);

    if (!attendee) {
      return false;
    }

    delete this.inst.model.attendeesIndex[attendee.id];

    this.attendeeById.delete(attendee.id);
    this.attendeeByUserAccountId.delete(attendee.userAccountID);
    this.attendeeByPhoneAudio.delete(attendee.phoneAudio);

    const roomAttendees = this.getAttendeeMapByRoomId(attendee.room);
    roomAttendees.delete(attendee.id);

    const attendeesByRole = this.getAttendeesByRole(attendee.role);
    attendeesByRole.delete(attendee.id);

    return true;
  }

  updateAttendee(id: Attendee['id'] | Attendee['userAccountID'], data: Partial<Attendee>): boolean {
    const attendee = this.getAttendee(id);

    if (!attendee) {
      return false;
    }

    const canResetIndexes = this.canResetIndexes(data);

    if (canResetIndexes) {
      this.removeAttendee(attendee.id);
    }

    Object.assign(attendee, data);

    if (canResetIndexes) {
      this._addAttendee(attendee);
    }

    return true;
  }

  getAttendee(id: Attendee['id'] | Attendee['userAccountID']): Attendee | null {
    return this.attendeeById.get(id) || this.attendeeByUserAccountId.get(id) || null;
  }

  getAttendeeList(exclude?: Set<Attendee['id'] | Attendee['userAccountID']>): Attendee[] {
    if (exclude) {
      const attendees = [];

      this.attendeeById.forEach((attendee) => {
        if (!exclude.has(attendee.id) && !exclude.has(attendee.userAccountID)) {
          attendees.push(attendee);
        }
      });
      return attendees;
    }

    return Array.from(this.attendeeById.values());
  }

  getAttendees(): IterableIterator<[Attendee['id'], Attendee]> {
    return this.attendeeById.entries();
  }

  getAttendeeById(aid: Attendee['id']): Attendee | null {
    return this.attendeeById.get(aid) || null;
  }

  getAttendeeByUserAccountId(uid: Attendee['userAccountID']): Attendee | null {
    return this.attendeeByUserAccountId.get(uid) || null;
  }

  getAttendeeByPhoneAudio(callSid: Attendee['phoneAudio']): Attendee | null {
    return this.attendeeByPhoneAudio.get(callSid) || null;
  }

  getAttendeeMapByRoomId(rid: Attendee['room']): Map<Attendee['id'], Attendee> {
    return this.attendeesByRoom.get(rid) || new Map();
  }

  getAttendeesByRole(role: Roles): Map<Attendee['id'], Attendee> {
    return this.attendeesByRole.get(role) || new Map();
  }

  private canResetIndexes(pack: Partial<Attendee>): boolean {
    if ('role' in pack) {
      return true;
    }

    if ('room' in pack) {
      return true;
    }

    if ('userAccountID' in pack) {
      return true;
    }

    if ('phoneAudio' in pack) {
      return true;
    }

    return false;
  }
}
