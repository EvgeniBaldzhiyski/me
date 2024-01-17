import { Actor } from 'xstate/lib/Actor';
import { assign, interpret, Interpreter, Machine, MachineConfig, State, StateMachine } from 'xstate';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { v4 } from 'uuid';
import { RemoteWorkerFactory } from '@container/task-queue';
import { Logger } from 'winston';
import { TaskController, TaskStatus, TaskEvent } from '../../../../tasks/task-resources';
import { createWorkerMachine, RemoteWorkerContext, RemoteWorkerEvent } from '../../../../tasks/worker-machine';

interface MixerContext {
  castBox: Actor<State<RemoteWorkerContext, RemoteWorkerEvent>>;
  castBoxJobData: MixerBoxJob;
}

interface MixerStateSchema {
  states: {
    idle: {},
    starting: {},
    working: {},
    failed: {},
    done: {}
  };
}

export class MixerBoxJob {
  constructor(
    private readonly mrid: string,
    private readonly url: string,
    private readonly userId: string,
    private readonly roomId: string
  ) {}

  static fromAny(data: any) {
    if (!data.mrid) {
      throw new Error(`Missing property "mrid"`);
    }
    if (!data.url) {
      throw new Error(`Missing property "url"`);
    }
    if (!data.userId) {
      throw new Error(`Missing property "userId"`);
    }
    if (!data.roomId) {
      throw new Error(`Missing property "roomId"`);
    }
    return new MixerBoxJob(data.mrid, data.url, data.userId, data.roomId);
  }
}

export class MixerController implements TaskController {

  public readonly observer = new EventEmitter();

  private readonly machine: StateMachine<MixerContext, MixerStateSchema, TaskEvent>;
  private readonly service: Interpreter<MixerContext, MixerStateSchema, TaskEvent>;
  private readonly id: string;

  constructor(
    private readonly castWorkerFactory: RemoteWorkerFactory,
    private readonly jobId: string,
    private readonly jobPayload: MixerBoxJob,
    private readonly logger: Logger
  ) {
    this.id = crypto.randomBytes(5).toString('hex');
    this.logger.info(`Mixer ${this.id} working on`, {jobPayload: this.jobPayload});

    const config = {
      id: `mixer-controller-${this.id}`,
      initial: 'idle',
      context: {
        castBox: undefined,
        castBoxJobData: MixerBoxJob.fromAny(this.jobPayload),
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
            id: 'cast-box',
            src: context => {
              return createWorkerMachine(this.castWorkerFactory, v4(), context.castBoxJobData, this.logger, this.service);
            },
            onDone: {
              actions: [
                assign<MixerContext, TaskEvent>({
                  castBox: (context, event) => {
                    return event.data as Actor<State<RemoteWorkerContext, RemoteWorkerEvent>>;
                  },
                  castBoxJobData: (context, event) => context.castBoxJobData
                }),
                (context, event) => {
                  context.castBox.send({type: 'START'});
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
      stop: (context) => {
        if (context.castBox) {
          context.castBox.send({type: 'STOP'});
        }
      },
      notifyWorking: () => {
        this.observer.emit('message', {jobId: this.jobId, status: TaskStatus.WORKING});
      },
      notifyFailed: () => {
        this.observer.emit('message', {jobId: this.jobId, status: TaskStatus.FAILED});
      },
      notifyDone: () => {
        this.observer.emit('message', {jobId: this.jobId, status: TaskStatus.DONE});
      }
    };

    this.machine  = Machine<MixerContext, MixerStateSchema, TaskEvent>(
      config as MachineConfig<MixerContext, MixerStateSchema, TaskEvent>,
      {actions}
    );
    this.service = interpret(this.machine).onTransition(state => {
      if (state.changed) {
        this.logger.info(
          `Mixer ${this.id} transition from ${state.history.value} to ${state.value}, triggered by ${state.event.type}`,
          {jobPayload: this.jobPayload}
        );
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
