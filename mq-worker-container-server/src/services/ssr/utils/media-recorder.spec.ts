/* eslint-disable no-invalid-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable arrow-body-style */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-explicit-any */
require('../../../__mock__/mock-apm');

import { EventEmitter } from 'events';
import { firstValueFrom, lastValueFrom, Subject, switchMap, tap } from 'rxjs';
import { mediaRecorder } from './media-recorder';

jest.mock('blob-to-buffer', () => {
  const originalModule = jest.requireActual('blob-to-buffer');
  return {__esModule: true, ...originalModule,
    default: jest.fn((data, callback) => callback(false, data)),
  };
});

class MockMediaRecorder extends EventEmitter{
  start() { }
  stop() { }
}

global.MediaRecorder = MockMediaRecorder as any;

describe('media-recorder', () => {
  it('Ok', async () => {
    const spyStop = jest.spyOn(MockMediaRecorder.prototype, 'stop');
    const spyStart = jest.spyOn(MockMediaRecorder.prototype, 'start');

    const value = await firstValueFrom(mediaRecorder({} as MediaStream));

    expect(value).toBeInstanceOf(Subject);
    expect(spyStart).toBeCalled();
    expect(spyStop).toBeCalled();
  });

  it('Fail', async () => {
    const spyStart = jest.spyOn(MockMediaRecorder.prototype, 'start').mockImplementation(function() {
      setTimeout(() => {
        this.emit('dataavailable', {data: '{{TEST_VALUE}}'});
        this.emit('error', new Error('{{TEST_ERROR}}'));
      }, 20);
    });
    const controlledSpy = jest.fn();

    let testError: Error;

    try {
      await lastValueFrom(mediaRecorder({} as MediaStream).pipe(
        switchMap(stream => {
          return stream.pipe(
            tap(data => controlledSpy(data))
          );
        })
      ));
    } catch(error) {
      testError = error;
    }

    expect(spyStart).toBeCalled();
    expect(controlledSpy).toBeCalledWith('{{TEST_VALUE}}');
    expect(testError).toBeInstanceOf(Error);
  });
});
