import { Actor } from 'xstate/lib/Actor';
import { assign, interpret, Interpreter, Machine, MachineConfig, State, StateMachine } from 'xstate';
import { EventEmitter } from 'events';
import { RecStartTaskQueuePac, StreamData } from '@container/models';
import crypto from 'crypto';
import { v4 } from 'uuid';
import { RemoteWorkerFactory } from '@container/task-queue';
import { Logger } from 'winston';
import { TaskController, TaskEvent, TaskStatus } from '../../../../tasks/task-resources';
import { createWorkerMachine, RemoteWorkerContext, RemoteWorkerEvent } from '../../../../tasks/worker-machine';


interface RecBoxJobData {
  streamData: StreamData;
  metadata: RecStartTaskQueuePac;
}

interface RecordingContext {
  recBox: Actor<State<RemoteWorkerContext, RemoteWorkerEvent>>;
  recBoxJobData: RecBoxJobData;
}

interface RecordingStateSchema {
  states: {
    idle: {},
    starting: {},
    recording: {},
    failed: {},
    done: {}
  };
}

export class PersonalRecordingController implements TaskController {

  public readonly observer = new EventEmitter();

  private readonly machine: StateMachine<RecordingContext, RecordingStateSchema, TaskEvent>;
  private readonly service: Interpreter<RecordingContext, RecordingStateSchema, TaskEvent>;
  private readonly id: string;

  constructor(
    private readonly recWorkerFactory: RemoteWorkerFactory,
    private readonly jobId: string,
    private readonly jobPayload: RecBoxJobData,
    private readonly logger: Logger
  ) {
    this.id = crypto.randomBytes(5).toString('hex');
    this.logger.debug(`Personal Media Record ${this.id} work message: ${JSON.stringify(this.jobPayload)}`);

    const config = {
      id: `pmr-controller-${this.id}`,
      initial: 'idle',
      context: {
        recBox: undefined,
        recBoxJobData: this.jobPayload
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
            WORKER_STARTED: 'recording',
            WORKER_FAILED: 'failed',
            WORKER_DONE: 'failed',
            STOP: 'done',
          },
          invoke: {
            id: 'pmr-box',
            src: context => {
              return createWorkerMachine(recWorkerFactory, v4(), context.recBoxJobData, this.logger, this.service);
            },
            onDone: {
              actions: [
                assign<RecordingContext, TaskEvent>({
                  recBox: (context, event) => {
                    return event.data as Actor<State<RemoteWorkerContext, RemoteWorkerEvent>>;
                  },
                  recBoxJobData: (context, event) => context.recBoxJobData
                }),
                (context, event) => {
                  context.recBox.send({type: 'START'});
                }
              ]
            },
            onError: {
              target: 'failed'
            }
          }
        },
        recording: {
          entry: ['notifyWorking'],
          on: {
            WORKER_FAILED: 'failed',
            WORKER_DONE: 'failed',
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
        if (context.recBox) {
          context.recBox.send({type: 'STOP'});
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

    this.machine  = Machine<RecordingContext, RecordingStateSchema, TaskEvent>(
      config as MachineConfig<RecordingContext, RecordingStateSchema, TaskEvent>,
      {actions}
    );
    this.service = interpret(this.machine).onTransition(state => {
      if (state.changed) {
        this.logger.debug(
          `Personal Media Record ${this.id} transition from ${state.history.value} to ${state.value},` +
          ` triggered by ${state.event.type} job payload: ${JSON.stringify(this.jobPayload)}`);
      }
    });
    this.service.start();
  }

  start() {
    this.service.send('START');
  }

  stop() {
    this.service.send('STOP');
  }

}
