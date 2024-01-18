/* eslint-disable unused-imports/no-unused-imports-ts */
/* eslint-disable @typescript-eslint/no-unused-vars */
require('../../../__mock__/mock-apm');

import { firstValueFrom, of } from 'rxjs';

class MockCoreApi {
  post() {
    return of({data: 'TEST-OK'});
  }
}

import { sendVideoInformation } from './core-api.gateway';
import { SsrPayload } from './ssr-payload';

jest.mock('../../../communication/core-api.client', () => {
  const originalModule = jest.requireActual('../../../communication/core-api.client');
  return {__esModule: true, ...originalModule,
    coreApi: new MockCoreApi(),
  };
});

describe('core-api.gateway', () => {
  it('Should send good dto', async () => {
    const spy = jest.spyOn(MockCoreApi.prototype, 'post');

    const value = await firstValueFrom(sendVideoInformation('KEY', {
      playlistId: 'PLAYLIST-ID',
      title: 'TITLE',
      mid: 'MID',
      aid: 'AID',
      rid: 'RID'
    } as SsrPayload, {
      duration: 10,
      size: 100000,
      birthtimeMs: 10000
    }));

    expect(value).toBe('TEST-OK');
    expect(spy).toBeCalledWith('ssr/record/add', {
      playlistId: 'PLAYLIST-ID',
      title: 'TITLE',
      mid: 'MID',
      meetingAttendeeId: 'AID',
      recordPath: 'KEY',
      recordDuration: 10,
      fileSize: 100000,
      startTime: 10000,
      boRoomId: 'RID'
    });
  });
});
