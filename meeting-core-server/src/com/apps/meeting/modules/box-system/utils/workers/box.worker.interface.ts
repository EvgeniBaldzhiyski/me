import { TaskStatus } from '../../../../../../tasks/task-resources';
import { BoxWorkerRetry, BoxWorkerStarted, BoxWorkerStopped, Room } from '@container/models';
import { StateInterface } from '../../../BaseModule';

export const BoxWorkerEventByTaskStatus = {
  [TaskStatus.WORKING]: BoxWorkerStarted,
  [TaskStatus.DONE]: BoxWorkerStopped,
  [TaskStatus.FAILED]: BoxWorkerRetry,
};

export interface BoxWorkerBasePayload {
  id: Room['id'];
}

export interface BoxWorkerMongodbSchema<T extends BoxWorkerBasePayload = BoxWorkerBasePayload> extends StateInterface {
  workers: T[];
}

