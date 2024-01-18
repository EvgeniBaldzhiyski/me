/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
require('../../../__mock__/mock-apm');

import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import { catchError, EMPTY, of, Subject, takeUntil, tap } from 'rxjs';
import config from 'config';
import { AmazonTranscribeProvider } from './amazon-transcribe.provider';

const MockMicrophoneStream: any = [Buffer.from(''), Buffer.from('')];

MockMicrophoneStream.on = jest.fn();
MockMicrophoneStream.resume = jest.fn();
MockMicrophoneStream.destroy = jest.fn();
MockMicrophoneStream.toRaw = jest.fn();

const MockTranscribeStreamingClient = {
  send: jest.fn(),
  destroy: jest.fn()
};

global.AudioContext = jest.fn();

jest.mock('@aws-sdk/client-transcribe-streaming', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-transcribe-streaming');

  return {
    __esModule: true,
    ...originalModule,
    TranscribeStreamingClient: jest.fn(() => MockTranscribeStreamingClient),
    StartStreamTranscriptionCommand: jest.fn(),
  };
});

jest.mock('microphone-stream', () => {
  const originalModule = jest.requireActual('microphone-stream');

  return {
    __esModule: true,
    ...originalModule,
    default: jest.fn(() => MockMicrophoneStream),
  };
});

describe('generate-media-stream', () => {
  const destruct$ = new Subject<void>();

  const driver = new AmazonTranscribeProvider();

  beforeAll(() => {
    require('../../../__mock__/mock-nwjs');
  });

  afterEach(() => {
    destruct$.next();

    jest.restoreAllMocks();
  });

  it('Should connect returns nice result and stops gracefully', done => {
    const transcriptResultStream = of({
      TranscriptEvent: { Transcript: { Results: [{
        Alternatives: [{Transcript: 'test-replica'}],
        ResultId: 'any-transcript-id',
        IsPartial: false
      }] }}
    });
    MockTranscribeStreamingClient.send.mockImplementation(() => new Promise(observer => observer({
      TranscriptResultStream: transcriptResultStream
    })));

    const checkResultSpy = jest.fn();

    driver.connect({} as MediaStream).pipe(
      catchError(err => {
        done(err);
        return EMPTY;
      }),
      takeUntil(destruct$),
    ).subscribe(res => {
      checkResultSpy(res);

      destruct$.next();

      try {
        expect(TranscribeStreamingClient).toBeCalledWith({
          region: config.get('aws.transcribe.region'),
          credentials: {
            accessKeyId: config.get('aws.transcribe.accessKeyId'),
            secretAccessKey: config.get('aws.transcribe.secretAccessKey'),
          }
        });
        expect(StartStreamTranscriptionCommand).toBeCalledWith({
          LanguageCode: config.get('aws.transcribe.languageCode'),
          MediaSampleRateHertz: config.get('aws.transcribe.mediaSampleRateHertz'),
          MediaEncoding: config.get('aws.transcribe.mediaEncoding'),
          AudioStream: expect.anything()
        });
        expect(MockTranscribeStreamingClient.send).toBeCalledTimes(1);
        expect(MockTranscribeStreamingClient.destroy).toBeCalledTimes(1);

        expect(checkResultSpy).toBeCalledWith(transcriptResultStream);
        done();
      } catch(err) {
        done(err);
      }
    });
  });

  it('Should transcribe returns nice replica', done => {
    const transcriptResultStream: any = of({
      TranscriptEvent: { Transcript: { Results: [{
        Alternatives: [{Transcript: 'test-replica'}],
        ResultId: 'any-transcript-id',
        IsPartial: false
      }] }}
    });
    const checkResultSpy = jest.fn();

    driver.transcribe(transcriptResultStream).pipe(
      catchError(err => {
        done(err);
        return EMPTY;
      }),
      takeUntil(destruct$),
    ).subscribe(res => {
      checkResultSpy(res);

      destruct$.next();

      try {
        expect(checkResultSpy).toBeCalledWith({
          transcript: 'test-replica',
          resultId: 'any-transcript-id',
          isPartial: false
        });
        done();
      } catch(err) {
        done(err);
      }
    });
  });

  it('Should throw an error if client has failed', done => {
    const errorObject = new Error('send error');
    MockTranscribeStreamingClient.send.mockImplementation(() => { throw errorObject; });

    driver.connect({} as MediaStream).pipe(
      tap(() => expect(true).toBeFalsy()),
      catchError(error => {
        try {
          expect(error).toBe(errorObject);

          expect(MockTranscribeStreamingClient.destroy).toBeCalledTimes(1);

          done();
        }catch (err) {
          done(err);
        }
        return EMPTY;
      }),
    ).subscribe();
  });
});
