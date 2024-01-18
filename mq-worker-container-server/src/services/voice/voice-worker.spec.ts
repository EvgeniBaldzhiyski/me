/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable arrow-body-style */
/* eslint-disable unused-imports/no-unused-imports-ts */
// import { catchError } from 'rxjs';
require('../../__mock__/mock-apm');
require('../../__mock__/mock-nwjs');

import { MockMediaStream, MockMediaStreamTrack } from '../../__mock__/mock-nwjs';
import { of, Subject } from 'rxjs';

function generateMediaStream() {
  const stream = new MockMediaStream();
  stream.addTrack(new MockMediaStreamTrack('audio'));
  stream.addTrack(new MockMediaStreamTrack('video'));
  return stream;
}

const mockGenerateMediaStream  = () => {
  const stream = generateMediaStream();
  return of(stream);
};

jest.mock('../../core/stream-generator', () => {
  return {
    generateMediaStream: mockGenerateMediaStream,
    getMediaStreamLogChinks: jest.fn(() => ({}))
  };
});

class MockDataStream extends Subject<string> {}

const mockJoinInMediaRoom = jest.fn(() => {
  return of({
    producerFactory: {
      create: () => ({
        produce: () => of(new MockDataStream())
      })
    }
  });
});

jest.mock('../../communication/media.gateway', () => {
  return { joinInMediaRoom: mockJoinInMediaRoom };
});

const MockVoiceProvider =  {
  exchange: jest.fn(() => {
    return of(generateMediaStream());
  }),
};

import { VoiceWorker, VoiceWorkerFactory } from './voice.worker';

const mockPayload = {
  url: 'mock-url',
  cid: 'companuy-id',
  mid: 'session-id',
  mrunid: 'session-run-id',
  aid: 'attendee-id',
  rid: 'room-id',
  meetingName: 'meeting-name'
};

let voiceWorker;

describe('Run phase', () => {
  beforeEach(async () => {
    const factoryWorker = new VoiceWorkerFactory();
    voiceWorker = await factoryWorker.create({
      id: 'voice-worker-id',
      payload: mockPayload
    }) as VoiceWorker;
    (voiceWorker as any).voiceProvider = MockVoiceProvider;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Create a voice worker', () => {
    expect(voiceWorker.id).toBe('voice-worker-id');
    expect(voiceWorker.payload).toMatchObject(mockPayload);
  });

  it('Success', async () => {
    const spyAccept = jest.fn(() => {
      setTimeout(() => {
        (voiceWorker as any).stopTask$.next(true);
      });
      return Promise.resolve();
    });
    const spyReady = jest.fn(() => Promise.resolve());
    (voiceWorker as any).voiceProvider = MockVoiceProvider;
    await voiceWorker.run(spyAccept, spyReady);

    expect(spyAccept).toHaveBeenCalledWith(mockPayload);
    expect(voiceWorker.run.bind(voiceWorker,spyAccept, spyReady)).not.toThrowError();
  });
});
