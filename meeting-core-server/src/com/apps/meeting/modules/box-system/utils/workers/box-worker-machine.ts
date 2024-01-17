import apm from 'elastic-apm-node/start';
import { RemoteWorker, RemoteWorkerFactory, WorkerMessage, WorkerStatus } from '@container/task-queue';
import { assign, interpret, Machine, MachineConfig, sendParent } from 'xstate';
import crypto from 'crypto';
import { Logger } from 'winston';

export interface RemoteWorkerSchema {
  states: {
    idle: {},
    initializing: {},
    starting: {},
    working: {},
    failed: {},
    done: {}
  };
}

export type RemoteWorkerEvent =
  | { type: 'START' }
  | { type: 'WORKING', data: any }
  | { type: 'FAILED', data: any }
  // events passed to parent, shouldn't be handled by worker internally
  | { type: 'WORKER_STARTED', data: any }
  | { type: 'WORKER_FAILED', data: any }
  | { type: 'MESSAGE', data: any }
  | { type: 'STOP' }
  | { type: 'DONE', data: any };

export interface RemoteWorkerContext {
  worker: RemoteWorker;
  response: any;
}

// this file is directly 1:1 copied from worker-machine.ts
// the only DIFF is how we handle the DONE state of a worker
// here DONE state actually states DONE instead of FAIL
export const createBoxWorkerMachine =
  async (workerFactory: RemoteWorkerFactory, id: string, payload: any, logger: Logger, parent?: any) => {
    const worker = workerFactory.create(id, payload);

    if (!worker) {
      throw new Error(`Couldn't create RemoteWorker(${id})`);
    }

    const config = {
      id: `remote-worker-${crypto.randomBytes(5).toString('hex')}`,
      initial: 'idle',
      context: {
        worker,
        response: undefined
      },
      on: {
        MESSAGE: [{actions: ['sendToRemoteWorker']}]
      },
      states: {
        idle: {
          on: {
            START: 'initializing',
            STOP: 'done'
          }
        },
        initializing: {
          invoke: {
            id: 'initialize-worker',
            src: (context, event) => context.worker.run(),
            onDone: 'starting',
            onError: 'failed'
          },
          on: {
            STOP: 'done',
            FAILED: 'failed'
          }
        },
        starting: {
          on: {
            STOP: 'done',
            FAILED: 'failed',
            WORKING: {
              target: 'working',
              actions: [
                assign<RemoteWorkerContext, RemoteWorkerEvent>({
                  worker: (context, event) => context.worker,
                  response: (context, event) => event.data
                }),
                sendParent<RemoteWorkerContext, RemoteWorkerEvent>((context, event) => ({
                  type: 'WORKER_STARTED',
                  data: context.response
                }))
              ]
            }
          }
        },
        working: {
          on: {
            STOP: 'done',
            FAILED: 'failed',
            DONE: 'done'
          }
        },
        failed: {
          entry: [
            assign<RemoteWorkerContext, RemoteWorkerEvent>({
              worker: (context, event) => context.worker,
              response: (context, event) => event.data
            }),
            sendParent<RemoteWorkerContext, RemoteWorkerEvent>((context, event) => ({
              type: 'WORKER_FAILED',
              data: context.response
            })),
            'stop'
          ]
        },
        done: {
          entry: [sendParent('WORKER_DONE'), 'stop'],
        }
      }
    };

    const actions = {
      stop: (context, event) => {
        if (context.worker) {
          context.worker.observer.removeAllListeners('message');
          context.worker.postMessage({command: 'stop'});
          context.worker.shutdown();
        }
      },
      sendToRemoteWorker: async (context, event) => {
        await worker.postMessage(event.data);
      }
    };

    const machine = Machine<RemoteWorkerContext, RemoteWorkerSchema, RemoteWorkerEvent>(
      config as MachineConfig<RemoteWorkerContext, RemoteWorkerSchema, RemoteWorkerEvent>,
      {actions}
    );
    const service = interpret(machine, {parent});
    service.start();

    worker.observer.on('message', (data: WorkerMessage) => {
      if (data.status === WorkerStatus.WORKING) {
        service.send({type: 'WORKING', data: data.payload});
      }
      if (data.status === WorkerStatus.FAILED) {
        const error = new Error(`Worker failed with message: ${data.payload.error}`);
        apm.captureError(error);
        logger.error(error);
        service.send({type: 'FAILED', data: data.payload});
      }
      if (data.status === WorkerStatus.DONE) {
        service.send({type: 'DONE', data: data.payload});
      }
    });

    return service;
  };
