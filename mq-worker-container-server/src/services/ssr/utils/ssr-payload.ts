import { Payload } from '../../utils/payload';

export interface SsrPayload extends Payload {
  playlistId: string;
  videoId: string;
  title: string;
}
