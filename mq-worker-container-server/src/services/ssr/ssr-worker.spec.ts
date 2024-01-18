/* eslint-disable require-await */
/* eslint-disable unused-imports/no-unused-imports-ts */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-invalid-this */
/* eslint-disable dot-notation */
/* eslint-disable arrow-body-style */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/prefer-regexp-exec */
require('../../__mock__/mock-nwjs');
require('../../__mock__/mock-apm');

import { finalize, of, startWith, Subject, tap, timer } from 'rxjs';
import { MockMediaStream, MockMediaStreamTrack } from '../../__mock__/mock-nwjs';
import { EventEmitter } from 'events';

const mockGetMediaStreamLogChinks = jest.fn(() => {
  const stream = new MockMediaStream();
  stream.addTrack(new MockMediaStreamTrack('audio'));
  stream.addTrack(new MockMediaStreamTrack('video'));

  return of(stream);
});
jest.mock('../../core/stream-generator', () => {
  return {
    generateMediaStream: mockGetMediaStreamLogChinks,
    getMediaStreamLogChinks: jest.fn(() => ({}))
  };
});

jest.mock('../../utils/metrics', () => {
  return {
    runningSessionsGauge: {
      inc: jest.fn(),
      remove: jest.fn()
    }
  };
});

jest.mock('./utils/media-recorder', () => {
  return { mediaRecorder: jest.fn(() => of(new Subject().pipe(
    startWith('TEST_CHUNK')
  ))) };
});

const mockFFMPEGStdinWrite = jest.fn();
class MockFFMPEG extends EventEmitter {
  stdin = { write: mockFFMPEGStdinWrite };
  kill = jest.fn(() => {
    this.emit('close', 0);
  });
}
const mockVideoGenerator = jest.fn(() => {
  const ffmpeg = new MockFFMPEG();

  return (new Subject()).pipe(
    startWith(ffmpeg),
    finalize(() => {
      ffmpeg.emit('close', 0);
    })
  );
});
const mockVideoMetadata = {
  format: {
    size: 0,
    duration: 0,
    tags: { BIRTHTIME: 0 }
  }
};
const mockGetVideoMetadata = jest.fn(() => of(mockVideoMetadata));

jest.mock('./utils/video-generator', () => {
  return {
    videoGenerator: mockVideoGenerator,
    getVideoMetadata: mockGetVideoMetadata
  };
});

const mockValidateFileExists = jest.fn(() => of(true));
const mockValidateMinDuration = jest.fn(() => source => source);

jest.mock('./utils/video-validators', () => {
  const originalModule = jest.requireActual('./utils/video-validators');
  return {
    ...originalModule,
    validateFileExists: mockValidateFileExists,
    validateMinDuration: mockValidateMinDuration,
  };
});

const mockVideoUploader = jest.fn(() => of({}));

jest.mock('./utils/video-uploader', () => {
  return { videoUploader: mockVideoUploader };
});

const mockSendVideoInformation = jest.fn(() => of(undefined));

jest.mock('./utils/core-api.gateway', () => {
  return { sendVideoInformation: mockSendVideoInformation };
});

const mockUnlink = jest.fn(() => Promise.resolve());
jest.mock('fs/promises', () => {
  const originalModule = jest.requireActual('fs/promises');
  return { __esModule: true, ...originalModule, unlink: mockUnlink };
});
jest.mock('uuid', () => {
  const originalModule = jest.requireActual('uuid');
  return { __esModule: true, ...originalModule, v4: jest.fn(() => 'mockUID') };
});

import { SsrWorker, SSRWorkerStatus } from './ssr-worker';
import { SsrWorkerFactory } from '../ssr/ssr-worker';
import { FileExistValidator, MinDurationValidator } from './utils/video-validators';

// END MOCKS

describe('SSR Worker', () => {
  const factory = new SsrWorkerFactory();

  let worker: SsrWorker;

  const workerPayload = {title: 'any-title', url: 'http://any-domain.ext', mid: 'any-mid', rid: 'any-rid'};
  const spyAccept = jest.fn(() => Promise.resolve());
  const spyReady = jest.fn(() => Promise.resolve());
  const spyDuration = jest.spyOn(SsrWorker.prototype as any, 'getDuration');

  beforeEach(async () => {
    worker = await factory.create({
      id: 'job-id',
      payload: workerPayload
    }) as SsrWorker;
    worker['delayTimeBetweenStages'] = 0;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Create Worker', () => {
    expect(worker.id).toBe('job-id');
    expect(worker.payload).toMatchObject(workerPayload);
  });

  describe('Run Phase', () => {
    it('Ok', async () => {
      await worker.run(spyAccept, spyReady);

      expect(spyReady).toBeCalled();
      expect(spyAccept).toBeCalledWith(workerPayload);
      expect(mockFFMPEGStdinWrite).toBeCalledWith('TEST_CHUNK');
    });
  });

  describe('Shutdown Phase', () => {
    beforeEach(() => {
      worker['workerStatus$'].next(SSRWorkerStatus.DONE);
    });

    it('Ok', async () => {
      await worker.shutdown();

      expect(mockValidateFileExists).toBeCalled();
      expect(mockGetVideoMetadata).toBeCalled();
      expect(mockValidateMinDuration).toBeCalled();
      expect(mockVideoUploader).toBeCalled();
      expect(mockUnlink).toBeCalled();
      expect(mockSendVideoInformation).toBeCalled();
    });

    it('Fail (Validate)', async () => {
      const origin = mockValidateMinDuration.getMockImplementation();
      mockValidateMinDuration.mockImplementation(() => {
        return source => source.error(new MinDurationValidator('{{TEST_ERROR}}'));
      });

      let testError;

      try {
        await worker.shutdown();
      } catch (error) {
        testError = error;
      }

      expect(testError).toBeTruthy();

      mockValidateMinDuration.mockImplementation(origin);
    });

    it('Ok (Validate with backup)', async () => {
      const origin = mockGetVideoMetadata.getMockImplementation();
      (mockGetVideoMetadata as any).mockImplementation(() => timer(1).pipe(
        tap(() => { throw new Error('TEST_ERROR'); })
      ));

      await worker.shutdown();

      expect(spyDuration).toHaveBeenCalled();

      mockGetVideoMetadata.mockImplementation(origin);
    });
  });
});
