import { Logger } from 'winston';
import ServerAPI from '../../../utils/ServerAPI';
import Meeting from '../Meeting';
import { MockLogger, MockMeeting, MockServerApi } from '../modules/_TEST_/meeting-mocks.lib';
import { ConnectionStorage } from './connection.storage';

describe('connection.storage', () => {
  it('add connection', () => {
    const map = new Map;
          map.set('cid', {
            id: 'cid',
            data: { aid: 'aid'}
          });

    const serverAPI = new MockServerApi() as unknown as ServerAPI;
    (serverAPI as any).clients = map;

    const storage = new ConnectionStorage(
      new MockMeeting('meeting', 'test-instance',
        serverAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    storage.addUpdateConnection('aid', 'cid');

    expect(storage.getAttendeeId('cid')).toBe('aid');
    expect(storage.getClientId('aid')).toBe('cid');
    expect(storage.getAttendeeConnection('aid')?.id).toBe('cid');
  });

  it('update connection', () => {
    const storage = new ConnectionStorage(
      new MockMeeting('meeting', 'test-instance',
      new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    storage.addUpdateConnection('aid', 'cid');
    storage.addUpdateConnection('aid', 'cid-2');

    expect(storage.getAttendeeId('cid')).toBeFalsy();
    expect(storage.getClientId('aid')).toBe('cid-2');
  });

  it('remove connection by attendee id', () => {
    const storage = new ConnectionStorage(
      new MockMeeting('meeting', 'test-instance',
      new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    storage.addUpdateConnection('aid', 'cid');
    storage.removeConnection('aid');

    expect(storage.getAttendeeId('cid')).toBeFalsy();
    expect(storage.getClientId('aid')).toBeFalsy();
  });

  it('remove connection by client id', () => {
    const storage = new ConnectionStorage(
      new MockMeeting('meeting', 'test-instance',
      new MockServerApi() as unknown as ServerAPI,
        new MockLogger() as unknown as Logger
    ) as unknown as Meeting);

    storage.addUpdateConnection('aid', 'cid');
    storage.removeConnection('cid');

    expect(storage.getAttendeeId('cid')).toBeFalsy();
    expect(storage.getClientId('aid')).toBeFalsy();
  });
});
