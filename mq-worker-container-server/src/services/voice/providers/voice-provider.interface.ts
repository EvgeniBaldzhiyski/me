import { Observable } from 'rxjs';

export interface VoiceProvider {
  exchange(mid: string, rid: string, mediaStream: MediaStream): Observable<MediaStream>;
}
