import ServerAPI from '../../../utils/ServerAPI';
import { MockLogger, MockMeeting, MockServerApi } from '../modules/_TEST_/meeting-mocks.lib';
import { AttendeeStorage } from './attendee.storage';
import { Logger } from 'winston';
import Meeting from '../Meeting';
import { Attendee, AttendeeBase, Roles } from '@container/models';


describe('attendee.storage', () => {
  const testAttendeeData = {
    id: '<id>',
    role: '<role>',
    userAccountID: '<userAccountId>',
    room: 'room',
  };

  it('add attendee', () => {
    const storage = new AttendeeStorage(
      new MockMeeting('meeting', 'test-instance',
        new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    const attendee = storage.addAttendee(testAttendeeData as AttendeeBase);

    expect(attendee).toBeInstanceOf(Attendee);
    expect(attendee.id).toBe(testAttendeeData.id);

    expect(storage.getAttendeeById(testAttendeeData.id)?.id).toBe(testAttendeeData.id);
    expect(storage.getAttendeeByUserAccountId(testAttendeeData.userAccountID)?.id).toBe(testAttendeeData.id);

    expect(storage.getAttendeesByRole(testAttendeeData.role as Roles)?.get(testAttendeeData.id)?.id).toBe(testAttendeeData.id);
    expect(storage.getAttendeeMapByRoomId(testAttendeeData.room)?.get(testAttendeeData.id)?.id).toBe(testAttendeeData.id);
  });

  it('update attendee', () => {
    const storage = new AttendeeStorage(
      new MockMeeting('meeting', 'test-instance',
        new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    const updateAttendeeData = {
      role: 'role-2',
      userAccountID: 'userAccountID-2',
      room: 'room-2'
    };


    const spyCanResetIndexes = jest.spyOn(storage as any, 'canResetIndexes');

    storage.addAttendee(testAttendeeData as AttendeeBase);
    storage.updateAttendee(testAttendeeData.id, updateAttendeeData as Partial<Attendee>);

    expect(spyCanResetIndexes).toBeCalledTimes(1);

    expect(storage.getAttendeeById(testAttendeeData.id)).toBeTruthy();

    expect(storage.getAttendeeByUserAccountId(testAttendeeData.userAccountID)).toBeFalsy();
    expect(storage.getAttendeeByUserAccountId(updateAttendeeData.userAccountID)).toBeTruthy();

    expect(storage.getAttendeesByRole(testAttendeeData.role as Roles)?.size).toBe(0);
    expect(storage.getAttendeesByRole(updateAttendeeData.role as Roles)?.size).toBe(1);
    expect(storage.getAttendeesByRole(updateAttendeeData.role as Roles)?.get(testAttendeeData.id)?.id).toBe(testAttendeeData.id);

    expect(storage.getAttendeeMapByRoomId(testAttendeeData.room)?.size).toBe(0);
    expect(storage.getAttendeeMapByRoomId(updateAttendeeData.room)?.size).toBe(1);
    expect(storage.getAttendeeMapByRoomId(updateAttendeeData.room)?.get(testAttendeeData.id)?.id).toBe(testAttendeeData.id);
  });

  it('remove attendee', () => {
    const storage = new AttendeeStorage(
      new MockMeeting('meeting', 'test-instance',
        new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    storage.addAttendee(testAttendeeData as AttendeeBase);
    storage.removeAttendee(testAttendeeData.id);

    expect(storage.getAttendeeById(testAttendeeData.id)).toBeFalsy();
    expect(storage.getAttendeeByUserAccountId(testAttendeeData.userAccountID)).toBeFalsy();
    expect(storage.getAttendeesByRole(testAttendeeData.role as Roles)?.size).toBe(0);
    expect(storage.getAttendeeMapByRoomId(testAttendeeData.room)?.size).toBe(0);
  });

  it('do not reset indexes', () => {
    const storage = new AttendeeStorage(
      new MockMeeting('meeting', 'test-instance',
        new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    const updateAttendeeData = {
      left: true,
    };

    const spyRemovingAttendee = jest.spyOn(storage as any, 'removeAttendee');

    storage.addAttendee(testAttendeeData as AttendeeBase);
    storage.updateAttendee(testAttendeeData.id, updateAttendeeData as Partial<Attendee>);

    expect(spyRemovingAttendee).not.toBeCalled();
  });

  it('should reset indexes', () => {
    const storage = new AttendeeStorage(
      new MockMeeting('meeting', 'test-instance',
        new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    const updateAttendeeData = {
      role: 'role-2',
    };

    const spyRemovingAttendee = jest.spyOn(storage as any, 'removeAttendee');

    storage.addAttendee(testAttendeeData as AttendeeBase);
    storage.updateAttendee(testAttendeeData.id, updateAttendeeData as Partial<Attendee>);

    expect(spyRemovingAttendee).toBeCalled();
  });

  it('check reset index flags', () => {
    const storage = new AttendeeStorage(
      new MockMeeting('meeting', 'test-instance',
        new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

      expect((storage as any).canResetIndexes({left: true})).toBe(false);
      expect((storage as any).canResetIndexes({room: 'room'})).toBe(true);
      expect((storage as any).canResetIndexes({role: 'role'})).toBe(true);
      expect((storage as any).canResetIndexes({userAccountID: '**'})).toBe(true);
  });
});
