import { Attendee } from '@container/models';
import { BoxWorkerStartTaskQueuePac } from '../utils/workers/box.worker.controller';
import { BoxWorkerBasePayload } from '../utils/workers/box.worker.interface';

export interface SsrWorkerStartTaskQueuePac extends BoxWorkerStartTaskQueuePac {
  title: string;
  playlistId: string;
  aid: Attendee['id'];
}

export interface SsrWorkerPayload extends BoxWorkerBasePayload {
  title: string;
  playlistId: string;
  aid: Attendee['id'];
}
