import { TranscriptResultStream } from '@aws-sdk/client-transcribe-streaming';
import { Observable } from 'rxjs';

export interface TranscribeProviderOutput {
  transcript: string;
  isPartial: boolean;
  resultId: string;
}

export interface TranscribeProvider {
  connect(mediaStream: MediaStream): Observable<AsyncIterable<TranscriptResultStream>>;
  transcribe(transcribeStream: AsyncIterable<TranscriptResultStream>): Observable<TranscribeProviderOutput>;
}
