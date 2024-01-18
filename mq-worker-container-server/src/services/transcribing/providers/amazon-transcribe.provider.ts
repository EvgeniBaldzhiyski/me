import {
  Result, StartStreamTranscriptionCommand,
  TranscribeStreamingClient, TranscriptResultStream, VocabularyFilterMethod
} from '@aws-sdk/client-transcribe-streaming';
import { filter, from, map, Observable, switchMap, tap } from 'rxjs';
import { TranscribeProvider, TranscribeProviderOutput } from './transcribe-provider.interface';
import config from 'config';
import { Readable } from 'readable-stream';
import logger from '../../../core/logger';
import MicrophoneStream from 'microphone-stream';

export class AmazonTranscribeProvider implements TranscribeProvider {
  connect(stream: MediaStream): Observable<AsyncIterable<TranscriptResultStream>> {
    logger.debug('FETCH TRANSCRIBE STREAM');

    return new Observable<TranscribeStreamingClient>(observer => {
      const client = new TranscribeStreamingClient({
        region: config.get('aws.transcribe.region'),
        credentials: {
          accessKeyId: config.get('aws.transcribe.accessKeyId'),
          secretAccessKey: config.get('aws.transcribe.secretAccessKey'),
        }
      });

      observer.next(client);

      return () => {
        logger.debug('DESTROY TRANSCRIBE CLIENT');
        client.destroy();
      };
    }).pipe(
      switchMap(client => this.mapToReadableStream(stream).pipe(
        switchMap(readableStream => from(client.send(new StartStreamTranscriptionCommand({
          LanguageCode: config.get('aws.transcribe.languageCode'),
          MediaSampleRateHertz: config.get('aws.transcribe.mediaSampleRateHertz'),
          MediaEncoding: config.get('aws.transcribe.mediaEncoding'),
          AudioStream: this.transcribeInput(readableStream),
          VocabularyFilterName: config.get('aws.transcribe.filterVocabularyName'),
          VocabularyFilterMethod: VocabularyFilterMethod.MASK,
          VocabularyName: config.get('aws.transcribe.vocabularyName'),
        }))).pipe(
          tap(() => logger.debug('FETCH TRANSCRIBE RES STREAM')),
          map(startStreamingResult => startStreamingResult.TranscriptResultStream)
        ))
      ))
    );
  }

  transcribe(transcribeStream: AsyncIterable<TranscriptResultStream>): Observable<TranscribeProviderOutput> {
    logger.debug('TRANSCRIBING...');

    return this.processing(transcribeStream);
  }

  private mapToReadableStream(stream: MediaStream) {
    return new Observable<Readable>(observer => {
      let micStream: MicrophoneStream & Readable = new MicrophoneStream({
        objectMode: false,
        context: new AudioContext({sampleRate: config.get('aws.transcribe.mediaSampleRateHertz')}),
        stream
      });

      // We need resume, because this triggering the consuming of the stream
      micStream.resume();

      observer.next(micStream);

      return () => {
        logger.debug('DESTROY MIC-STREAM');

        micStream.destroy();
        micStream = undefined;
      };
    });
  }

  private async *transcribeInput(readableStream: Readable) {
    for await(const chunk of readableStream) {
      yield {AudioEvent: {AudioChunk: this.pcmEncodeChunk(chunk)}};
    }
  }

  private pcmEncodeChunk(chunk) {
    const input = MicrophoneStream.toRaw(chunk);

    let offset = 0;
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));

      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return Buffer.from(buffer);
  }

  private processing(transcriptResultStream: AsyncIterable<TranscriptResultStream>): Observable<TranscribeProviderOutput> {
    logger.debug('START PROCESSING... ');

    return from(transcriptResultStream).pipe(
      filter(event =>
        !!event.TranscriptEvent?.Transcript?.Results[0]?.Alternatives[0]?.Transcript
      ),
      map(event => {
        const result: Result = event.TranscriptEvent.Transcript.Results[0];

        return {
          transcript: result.Alternatives[0].Transcript,
          resultId: result.ResultId,
          isPartial: result.IsPartial,
        };
      })
    );
  }
}
