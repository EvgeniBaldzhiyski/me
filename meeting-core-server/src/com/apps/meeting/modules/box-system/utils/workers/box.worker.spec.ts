import { fromEvent } from 'rxjs';
import { Model } from '@container/models';
import EventEmitter from 'events';
import { BoxWorker } from './box.worker';
import sleep from '../../../../../../utils/sleep';
import { BoxWorkerStatus } from '@container/models';
import { TaskStatus } from '../../../../../../tasks/task-resources';
import { workerFactoryCreator } from '../../../../../../tasks/worker-factory';

jest.mock('elastic-apm-node/start');
jest.mock('elastic-apm-http-client');
jest.mock('@container/apm-utils', () => {
  return {
    __esModule: true,
    ApmSpan: () => jest.fn(),
    ApmTransaction: () => jest.fn(),
    TransactionType: {WS_REQUEST: null}
  };
});

const mockBaseWorkerRabbitMQFactoryPromise = {
  start: jest.fn(() => Promise.resolve() as Promise<any>)
};

jest.mock('../../../../../../tasks/worker-factory', () => {
  return {
    workerFactoryCreator: () => {
      return {
        start: () => {
          return mockBaseWorkerRabbitMQFactoryPromise.start();
        }
      };
    }
  };
});


const mockGetGhostUserAuth = {
  getToken: jest.fn(async () => (Promise.resolve({access_token: 'TOKEN'})))
};

jest.mock('../../../../../../utils/get-ghost-user-auth', () => {
  return {
    getGhostUserAuth: () => mockGetGhostUserAuth.getToken()
  };
});

jest.mock('./box.worker.controller', () => {
  return {
    BoxWorkerController: jest.fn().mockImplementation(() => {
      const observer = new EventEmitter();
      return {
        observer,
        observer$: fromEvent(observer, 'message'),
        start: jest.fn(),
        stop: jest.fn()
      };
    })
  };
});

const MockMeeting = {
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  },
  model: new Model,
  eventBus: new EventEmitter()
};

// class for test purpose because box worker is abstract
class TestBoxWorker extends BoxWorker { }

describe('BoxWorker', () => {
  let worker: BoxWorker;

  const workerSpy = {
    mutateStateFromEvent: jest.spyOn(BoxWorker.prototype as any, 'mutateStateFromEvent'),
    getState: jest.spyOn(BoxWorker.prototype as any, 'getState'),
    getCurrentStatus: jest.spyOn(BoxWorker.prototype as any, 'getCurrentStatus'),
    start: jest.spyOn(BoxWorker.prototype as any, 'start'),
    stop: jest.spyOn(BoxWorker.prototype as any, 'stop'),
    hasJob: jest.spyOn(BoxWorker.prototype as any, 'hasJob'),
    isPaused: jest.spyOn(BoxWorker.prototype as any, 'isPaused'),
    triggerEvent: jest.spyOn(BoxWorker.prototype as any, 'triggerEvent'),
    createAndStartWorker: jest.spyOn(BoxWorker.prototype as any, 'createAndStartWorker'),
    destroyWorker: jest.spyOn(BoxWorker.prototype as any, 'destroyWorker'),
    bindWorkerEvents: jest.spyOn(BoxWorker.prototype as any, 'bindWorkerEvents'),
    shouldCreateRetry: jest.spyOn(BoxWorker.prototype as any, 'shouldCreateRetry'),
    shouldWorkerFailedRetry: jest.spyOn(BoxWorker.prototype as any, 'shouldWorkerFailedRetry'),
    handleWorkerEventsObservable: jest.spyOn(BoxWorker.prototype as any, 'handleWorkerEventsObservable'),
    createTaskQueueStartPack: jest.spyOn(BoxWorker.prototype as any, 'createTaskQueueStartPack'),
    createWorkerRabbitMQConnection: jest.spyOn(BoxWorker.prototype as any, 'createWorkerRabbitMQConnection'),
    generateMeetingUrlForRoom: jest.spyOn(BoxWorker.prototype as any, 'generateMeetingUrlForRoom'),
  };

  MockMeeting.model.meetingID = 'meeting-id-1';

  beforeEach(async () => {
    worker = new TestBoxWorker({id: 'room-id-1'}, MockMeeting as any);
  });

  afterEach(async () => {
    worker.stop();
    jest.clearAllMocks();
    jest.clearAllTimers();
    worker = undefined;
  });

  it('Should have correct default state', () => {
    const state = worker.getState();

    expect(state).toStrictEqual({
      id: 'room-id-1',
      status: BoxWorkerStatus.STOP
    });
  });

  it('Should correctly init and start worker', async (done) => {
    worker.start();

    await sleep(0);

    worker['worker'].observer.emit('message', {status: TaskStatus.WORKING});
    expect(worker.getState().status).toBe(BoxWorkerStatus.STARTED);
    expect(workerSpy.destroyWorker).not.toBeCalledTimes(2); // +1 is because worker is destroyed before try init
    done();
  });

  it('Should correctly stop and destroy worker', async (done) => {
    worker.start();

    await sleep(0);

    worker['worker'].observer.emit('message', {status: TaskStatus.WORKING});
    worker.stop();
    expect(workerSpy.destroyWorker).toBeCalledTimes(2); // +1 is because worker is destroyed before try init
    expect(worker.getState().status).toBe(BoxWorkerStatus.STOP);
    done();
  });

  it('Should try to retry when job is failed', async (done) => {
    // @ts-ignore
    worker['maxWorkerFailedAttempts'] = 2;
    // @ts-ignore
    worker.start();

    await sleep(0);

    worker['worker'].observer.emit('message', {status: TaskStatus.WORKING});
    worker['worker'].observer.emit('message', {status: TaskStatus.FAILED});

    await sleep(0);

    expect(worker.getState().status).toBe(BoxWorkerStatus.RETRYING);

    worker['worker'].observer.emit('message', {status: TaskStatus.WORKING});
    worker['worker'].observer.emit('message', {status: TaskStatus.FAILED});

    await sleep(0);

    expect(workerSpy.createAndStartWorker).toBeCalledTimes(3);  // +1 is because of initial start
    done();
  });

  it('Should try to retry worker start init', async (done) => {
    // @ts-ignore
    worker['startTimeout'] = 1000;
    // @ts-ignore
    worker['maxStartingAttempts'] = 2;
    worker.start();

    await sleep(5000);

    expect(workerSpy.createAndStartWorker).toHaveBeenCalledTimes(2);
    expect(worker.getState().status).toBe(BoxWorkerStatus.STOP);
    done();
  });

  it('Should try to retry worker init when Auth Token Generation Failed', async (done) => {
    mockGetGhostUserAuth.getToken.mockImplementation(async () => {
      throw new Error('Auth token generating failed');
    });

    const authTokenGenSpy = jest.spyOn(mockGetGhostUserAuth, 'getToken');

    // @ts-ignore
    worker['tokenGenerationRetryInterval'] = 0;
    // @ts-ignore
    worker['maxTokenGenerationFailedAttempts'] = 2;
    worker.start();

    await sleep(1000);

    expect(authTokenGenSpy).toHaveBeenCalledTimes(3); // +1 is because of initial start

    expect(workerSpy.createAndStartWorker).not.toHaveBeenCalled();
    expect(worker.getState().status).toBe(BoxWorkerStatus.STOP);
    mockGetGhostUserAuth.getToken.mockClear();
    mockGetGhostUserAuth.getToken.mockRestore();
    done();
  });

  it('Should try to retry worker init when RabbitMQ Connection failed', async (done) => {
    mockBaseWorkerRabbitMQFactoryPromise.start.mockImplementation(async () => {
      throw new Error('RabbitMQ Connection failed.');
    });

    const rabbitStartSpy = jest.spyOn(mockBaseWorkerRabbitMQFactoryPromise, 'start');

    // @ts-ignore
    worker['rabbitmqRetryInterval'] = 0;
    // @ts-ignore
    worker['maxRabbitmqInitFailedAttempts'] = 2;
    worker.start();

    await sleep(1000);

    expect(rabbitStartSpy).toHaveBeenCalledTimes(3); // +1 is because of initial start
    expect(workerSpy.createAndStartWorker).not.toHaveBeenCalled();
    expect(worker.getState().status).toBe(BoxWorkerStatus.STOP);
    mockBaseWorkerRabbitMQFactoryPromise.start.mockClear();
    mockBaseWorkerRabbitMQFactoryPromise.start.mockRestore();
    done();
  });
});

