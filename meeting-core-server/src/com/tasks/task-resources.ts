import { EventEmitter } from 'events';

export type TaskEvent =
  | {type: 'START', data?: any}

  | {type: 'WORKER_STARTED', data: any}
  | {type: 'WORKER_FAILED', data?: any}
  | {type: 'WORKER_DONE', data?: any}

  | {type: 'SEND_REFRESH_MESSAGE', data?: any}

  | {type: 'STOP', data?: any};

export enum TaskStatus {
  WORKING, DONE, FAILED
}

export interface TaskController {
  readonly observer: EventEmitter;
  start(): void;
  stop(): void;
}

export interface TaskMessage {
  jobId: string;
  status: TaskStatus;
  errorCode?: number;
}
