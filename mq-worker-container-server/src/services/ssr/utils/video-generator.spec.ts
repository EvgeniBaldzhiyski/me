/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-empty-function */
require('../../../__mock__/mock-apm');

import { delay, firstValueFrom, lastValueFrom, tap } from 'rxjs';
import { EventEmitter } from 'events';
import { videoGenerator, getVideoMetadata } from './video-generator';

class MockStdin extends EventEmitter {
  end() { }
  write() { }
}

class MockFFMPEG extends EventEmitter {
  stdin = new MockStdin();
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  constructor() {
    super();
    this.setup(this);
  }

  setup(_this_: MockFFMPEG) {
    setTimeout(() => _this_.emit('spawn'), 100);
  }
}

const metadata = '{"duration": 1000, "size": 1000}';
class MockFFProbe extends EventEmitter {
  stdin = new MockStdin();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = jest.fn();

  constructor() {
    super();
    this.setup(this);
  }

  setup(_this_: MockFFProbe) {
    setTimeout(() => {
      _this_.stdout.emit('data', metadata);
      _this_.emit('exit');
    }, 100);
  }
}

jest.mock('child_process', () => {
  const originalModule = jest.requireActual('child_process');
  return {__esModule: true, ...originalModule,
    spawn: jest.fn(prog => prog === 'ffmpeg' ? new MockFFMPEG() : new MockFFProbe()),
  };
});

describe('video-generator', () => {
  describe('videoGenerator', () => {
    it('Ok', async () => {
      const spyWrite = jest.spyOn(MockStdin.prototype, 'write');
      const spyEnd = jest.spyOn(MockStdin.prototype, 'end');

      const value = await firstValueFrom(videoGenerator('FILE_NAME'));

      expect(value).toBeInstanceOf(MockFFMPEG);
      expect(spyWrite).toBeCalledWith('q');
      expect(spyEnd).toBeCalled();
    });

    it('Fail', async () => {
      const spyEnd = jest.spyOn(MockStdin.prototype, 'end');

      let testError: Error;

      try {
        await lastValueFrom(videoGenerator('FILE_NAME').pipe(
          delay(20),
          tap(ffmpeg => (ffmpeg as undefined as MockFFMPEG).emit('error', new Error('{{TEST_ERROR}}')))
        ));
      } catch (error) {
        testError = error;
      }

      expect(testError).toBeTruthy();
      expect(spyEnd).toBeCalled();
    });
  });

  describe('getVideoMetadata', () => {
    it('Ok', async () => {
      const value = await firstValueFrom(getVideoMetadata('FILE_NAME'));

      expect(value).toMatchObject({duration: 1000, size: 1000});
    });

    it('Fail', async () => {
      jest.spyOn(MockFFProbe.prototype, 'setup').mockImplementation(_this_ => {
        setTimeout(() => _this_.emit('error', new Error('{{TEST_ERROR}}')), 100);
      });

      let testError: Error;

      try {
        await firstValueFrom(getVideoMetadata('FILE_NAME'));
      } catch (error) {
        testError = error;
      }

      expect(testError).toBeTruthy();
    });
  });
});

