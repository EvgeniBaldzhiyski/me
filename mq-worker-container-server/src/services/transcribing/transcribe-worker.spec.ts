/* eslint-disable arrow-body-style */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/prefer-regexp-exec */
require('../../__mock__/mock-nwjs');
require('../../__mock__/mock-apm');

import { of, Subject } from 'rxjs';
import { MockMediaStream, MockMediaStreamTrack } from '../../__mock__/mock-nwjs';

const mockGetMediaStreamLogChinks = jest.fn(() => {
  const stream = new MockMediaStream();
  stream.addTrack(new MockMediaStreamTrack('audio'));
  stream.addTrack(new MockMediaStreamTrack('video'));

  return of(stream);
});

class MockDataStream extends Subject<string> {}
const mockJoinInMediaRoom = jest.fn(() => of({
  producerFactory: {
    createData: () => ({
      produce: () => of(new MockDataStream())
    })
  }
}));
jest.mock('../../communication/media.gateway', () => {
  return { joinInMediaRoom: mockJoinInMediaRoom };
});

const mockAmazonTranscribeProviderChunk = {
  transcript: 'TRANSCRIPT',
  isPartial: 'ISPARTUAL',
  resultId: 'RESULTID',
};
class MockAmazonTranscribeProvider {
  transcribe = jest.fn(() => of(mockAmazonTranscribeProviderChunk));
  connect = jest.fn(() => of([]));
}

jest.mock('./providers/amazon-transcribe.provider', () => {
  return { AmazonTranscribeProvider: jest.fn(() => new MockAmazonTranscribeProvider()) };
});

import { TranscribeWorker, TranscribeWorkerFactory } from './transcribe-worker';

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

jest.mock('./utils/metrics', () => {
  return {
    transcribeSessionHistogram: {
      startTimer: jest.fn(() => () => { /* */ }),
    }
  };
});

// END MOCKS

describe('Transcribe Worker', () => {
  const factory = new TranscribeWorkerFactory();

  let worker: TranscribeWorker;

  const workerPayload = {title: 'any-title', url: 'http://any-domain.ext', mid: 'any-mid', rid: 'any-rid'};
  const spyAccept = jest.fn(() => Promise.resolve());
  const spyReady = jest.fn(() => Promise.resolve());

  beforeEach(async () => {
    worker = await factory.create({
      id: 'job-id',
      payload: workerPayload
    }) as TranscribeWorker;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('Create Worker', () => {
    expect(worker.id).toBe('job-id');
    expect(worker.payload).toMatchObject(workerPayload);
  });

  it('Ok', async () => {
    const dataSpy = jest.spyOn(MockDataStream.prototype, 'next');
    setTimeout(() => worker.onMessage({command: 'stop'}), 20);

    await worker.run(spyAccept, spyReady);

    expect(spyReady).toBeCalled();
    expect(spyAccept).toBeCalledWith(workerPayload);
    expect(dataSpy).toBeCalledWith(JSON.stringify(mockAmazonTranscribeProviderChunk));
  });

  it('Fail (in media gateway)', async () => {
    const throwError = () => { throw new Error('{{TEST_ERROR}}'); };
    mockJoinInMediaRoom.mockImplementation(throwError);

    let testError: Error;

    try {
      await worker.run(spyAccept, spyReady);
    } catch(error) {
      testError = error;
    }

    expect(testError?.message).toMatch('\{\{TEST_ERROR\}\}');
    expect(spyReady).toBeCalled();
    expect(spyAccept).not.toBeCalled();
  });

  it('Fail (in stream generator)', async () => {
    const throwError = () => { throw new Error('{{TEST_ERROR}}'); };
    jest.spyOn(MockMediaStream.prototype, 'addTrack').mockImplementation(throwError);

    let testError: Error;

    try {
      await worker.run(spyAccept, spyReady);
    } catch(error) {
      testError = error;
    }

    expect(testError?.message).toMatch('\{\{TEST_ERROR\}\}');
    expect(spyReady).toBeCalled();
    expect(spyAccept).not.toBeCalled();
  });
});
