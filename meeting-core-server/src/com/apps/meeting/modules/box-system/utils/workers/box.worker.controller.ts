import { TaskController, TaskEvent, TaskStatus } from '../../../../../../tasks/task-resources';
import { EventEmitter } from 'events';
import { assign, interpret, Interpreter, Machine, MachineConfig, State, StateMachine } from 'xstate';
import { RemoteWorkerFactory } from '@container/task-queue';
import { Model, Room, SessionSettings } from '@container/models';
import { Logger } from 'winston';
import crypto from 'crypto';
import { RemoteWorkerContext, RemoteWorkerEvent } from '../../../../../../tasks/worker-machine';
import { v4 } from 'uuid';
import { Actor } from 'xstate/lib/Actor';
import { fromEvent } from 'rxjs';
import { createBoxWorkerMachine } from './box-worker-machine';

export interface BoxWorkerStartTaskQueuePac {
  cid: SessionSettings['companyId'];
  rid: Room['id'];
  url: string;
  mid: Model['meetingID']
  mrunid: Model['meetingRunID'];
  meetingName: Model['sessionSettings']['name'];
}

interface BoxWorkerControllerContext {
  workerBox: Actor<State<RemoteWorkerContext, RemoteWorkerEvent>>;
  workerBoxJobData: BoxWorkerStartTaskQueuePac;
}

interface BoxWorkerControllerStateSchema {
  states: {
    idle: {},
    starting: {},
    working: {},
    failed: {},
    done: {}
  };
}

export class BoxWorkerController implements TaskController {
  public readonly observer = new EventEmitter();
  public readonly observer$ = fromEvent<{jobId: string; status: TaskStatus}>(this.observer, 'message');

  private readonly machine: StateMachine<BoxWorkerControllerContext, BoxWorkerControllerStateSchema, TaskEvent>;
  private readonly service: Interpreter<BoxWorkerControllerContext, BoxWorkerControllerStateSchema, TaskEvent>;
  private readonly id: string;

  constructor(
    private readonly workerConnectionFactory: RemoteWorkerFactory,
    private readonly jobId: string,
    private readonly jobPayload: BoxWorkerStartTaskQueuePac,
    private readonly logger: Logger,
    private readonly workerName: string
  ) {
    this.id = crypto.randomBytes(5).toString('hex');
    this.logger.info(`${this.workerName} ${this.id} working on with message: ${JSON.stringify(this.jobPayload)}`);

    const config = {
      id: `${this.workerName}-controller-${this.id}`,
      initial: 'idle',
      context: {
        workerBox: undefined,
        workerBoxJobData: this.jobPayload
      },
      states: {
        idle: {
          on: {
            STOP: 'done',
            START: 'starting'
          }
        },
        starting: {
          on: {
            WORKER_STARTED: 'working',
            WORKER_FAILED: 'failed',
            WORKER_DONE: 'failed',
            STOP: 'done',
          },
          invoke: {
            id: `${this.workerName}-box`,
            src: context => {
              return createBoxWorkerMachine(workerConnectionFactory, v4(), context.workerBoxJobData, this.logger, this.service);
            },
            onDone: {
              actions: [
                assign<BoxWorkerControllerContext, TaskEvent>({
                  workerBox: (context, event) => {
                    return event.data as Actor<State<RemoteWorkerContext, RemoteWorkerEvent>>;
                  },
                  workerBoxJobData: (context, event) => context.workerBoxJobData
                }),
                (context, event) => {
                  context.workerBox.send({type: 'START'});
                }
              ]
            },
            onError: {
              target: 'failed'
            }
          }
        },
        working: {
          entry: ['notifyWorking'],
          on: {
            WORKER_FAILED: 'failed',
            WORKER_DONE: 'done',
            STOP: 'done'
          },
        },
        failed: {
          entry: ['notifyFailed', 'stop'],
          type: 'final'
        },
        done: {
          entry: ['notifyDone', 'stop'],
          type: 'final'
        }
      }
    };

    const actions = {
      stop: (context, event) => {
        if (context.workerBox) {
          context.workerBox.send({type: 'STOP'});
        }
      },
      notifyWorking: (context, event) => {
        this.observer.emit('message', {jobId: this.jobId, status: TaskStatus.WORKING});
      },
      notifyFailed: (context, event) => {
        this.observer.emit('message', {jobId: this.jobId, status: TaskStatus.FAILED});
      },
      notifyDone: (context, event) => {
        this.observer.emit('message', {jobId: this.jobId, status: TaskStatus.DONE});
      }
    };

    this.machine = Machine<BoxWorkerControllerContext, BoxWorkerControllerStateSchema, TaskEvent>(
      config as MachineConfig<BoxWorkerControllerContext, BoxWorkerControllerStateSchema, TaskEvent>,
      {actions}
    );
    this.service = interpret(this.machine).onTransition(state => {
      if (state.changed) {
        this.logger.debug(
          `${this.workerName} ${this.id} transition from ${state.history.value} to ${state.value},` +
          ` triggered by ${state.event.type} job payload: ${JSON.stringify(this.jobPayload)}`);
      }
    });
    this.service.start();
  }

  start() {
    this.service.send('START');
    this.logger.info(`${this.workerName} ${this.id} started`);
  }

  stop() {
    this.service.send('STOP');
    this.logger.info(`${this.workerName} ${this.id} stopped`);
  }
}
