import { Room, ServerConnectionAPI } from '@container/models';
import { BoxWorkerStatus } from '@container/models';
import Client from '../../../../../utils/Client';
import { BoxWorker } from '../utils/workers/box.worker';
import TranscribeModule from './TranscribeModule';
import { Subscription } from 'rxjs';
import { BoxWorkerMongodbSchema } from '../utils/workers/box.worker.interface';
import { MockServerApi, MockMeeting, MockLogger, createModule  } from '../../_TEST_/meeting-mocks.lib';
import ServerAPI from '../../../../../utils/ServerAPI';
import { Logger } from 'winston';
import Meeting from '../../../Meeting';

jest.mock('mongodb');
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
jest.mock('../../../../../database/MongoDbStateManager', () => {
  return {
    __esModule: true,
    createMongoDbStateManager: jest.fn(() => ({
      saveState: jest.fn(() => Promise.resolve()),
      loadState: jest.fn(() => Promise.resolve()),
      deleteState: jest.fn(() => Promise.resolve()),
    })),
  };
});
jest.mock('../../../../../database/db.connection', () => {
  return {
    __esModule: true,
    defaultDb: jest.fn(() => ({collection: jest.fn(() => ({createIndex: jest.fn()}))})),
  };
});
jest.mock('../../../../../tasks/worker-factory', () => {
  return {
    transcribeFactoryPromise: {
      start: Promise.resolve()
    }
  };
});

// jest.useFakeTimers();

describe('TranscribeModule', () => {
  let module: TranscribeModule;

  const moduleSpy = {
    bindModuleEvents: jest.spyOn(TranscribeModule.prototype as any, 'bindModuleEvents'),
    startWorkerEndpoint: jest.spyOn(TranscribeModule.prototype as any, 'startWorkerEndpoint'),
    stopWorkerEndpoint: jest.spyOn(TranscribeModule.prototype as any, 'stopWorkerEndpoint'),
    startWorker: jest.spyOn(TranscribeModule.prototype as any, 'startWorker'),
    stopWorker: jest.spyOn(TranscribeModule.prototype as any, 'stopWorker'),
    onWorkerStateChange: jest.spyOn(TranscribeModule.prototype as any, 'onWorkerStateChange'),
    destroyWorker: jest.spyOn(TranscribeModule.prototype as any, 'destroyWorker'),
  };

  const spySendTo = jest.spyOn(MockServerApi.prototype, 'sendTo');

  const workerSpy = {
    start: jest.spyOn(BoxWorker.prototype, 'start'),
    stop: jest.spyOn(BoxWorker.prototype, 'stop'),
  };

  beforeEach(async () => {
    module = createModule(TranscribeModule);
    await module.setup();
    module['inst'].model.roomsIndex = {
      'normal-room-id-1': {id: 'normal-room-id-1', isTestRoom: false} as Room,
      'normal-room-id-2': {id: 'normal-room-id-1', isTestRoom: false} as Room,
      'test-room-id': {id: 'test-room-id', isTestRoom: true} as Room
    };
    module['inst'].model.sessionSettings.speechToTextEnabled = true;
  });

  afterEach(async () => {
    await module.beforeDestruct();
    await module.destruct();
    jest.clearAllMocks();
    jest.clearAllTimers();
    module = undefined;
  });

  it('Should create and start worker', async () => {
    const client = {data: {aid: 'any-aid', send: () => null}} as Client;

    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1'});

    expect(moduleSpy.startWorkerEndpoint).toBeCalled();
    expect(workerSpy.start).toBeCalled();
    expect(moduleSpy.onWorkerStateChange).toBeCalled();
    expect(module['workerStore'].size).toBe(1);

    expect(module['workerStore'].get('normal-room-id-1')).toMatchObject({
      worker: expect.any(BoxWorker),
      subscriptions: expect.any(Subscription)
    });
  });

  it('Should create and stop worker', () => {
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});
    module['stopWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});

    expect(moduleSpy.stopWorkerEndpoint).toHaveBeenCalled();
    expect(workerSpy.stop).toHaveBeenCalled();
    expect(moduleSpy.onWorkerStateChange).toBeCalledTimes(2); // 1 for start , 1 for stop
    expect(moduleSpy.destroyWorker).toBeCalledTimes(1);

    expect(module['workerStore'].size).toBe(0);
  });

  it('Should create only one worker', async () => {
    const client = {data: {aid: 'any-aid', send: () => null}} as Client;

    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1'});
    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1'});

    expect(moduleSpy.startWorkerEndpoint).toBeCalledTimes(2);
    expect(workerSpy.start).toBeCalledTimes(1);
    expect(moduleSpy.onWorkerStateChange).toBeCalledTimes(1);
    expect(module['workerStore'].size).toBe(1);
  });

  it('Should ignore if target room is test', () => {
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'test-room-id'});

    expect(module['workerStore'].size).toBe(0);
  });

  it('Should ignore if no target room', () => {
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {} as { id: Room['id'] });

    expect(module['workerStore'].size).toBe(0);
  });

  it('Should ignore if no existing worker', () => {
    module['stopWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'test-room-id'});

    expect(moduleSpy.stopWorkerEndpoint).toBeCalledTimes(1);
    expect(workerSpy.start).toBeCalledTimes(0);
  });


  it('Should get state properly of stopped worker', () => {
    const client = {data: {aid: 'any-aid'}, send: jest.fn()} as unknown as Client;

    module['getWorkerStateEndpoint'](client, {id: 'normal-room-id-1'});

    expect(spySendTo).toBeCalledWith(
      ServerConnectionAPI.GET_TRANSCRIBE_STATE,
      {id: 'normal-room-id-1', status: BoxWorkerStatus.STOP},
      client.id
    );
  });

  it('Should get state properly of worker in progress ', () => {
    const client = {data: {aid: 'any-aid'}, send: jest.fn()} as unknown as Client;

    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1'});
    module['getWorkerStateEndpoint'](client, {id: 'normal-room-id-1'});

    expect(spySendTo).toBeCalledWith(
      ServerConnectionAPI.GET_TRANSCRIBE_STATE,
      {id: 'normal-room-id-1', status: BoxWorkerStatus.INITIALIZING},
      client.id
    );
  });

  it('Should serialize state correctly', () => {
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-2'});

    const collection = module['serializeState']();

    expect(collection.workers.length).toBe(2);
  });

  it('Should populate state correctly', () => {
    const workersMongoState = {workers: [{id: 'normal-room-id-1'}, {id: 'normal-room-id-2'}]} as BoxWorkerMongodbSchema;

    module['populateState'](workersMongoState);

    const workerState = module['workerStore'];

    expect(workerState.size).toBe(2);

    workerState.forEach(state => {
      expect(state.worker.getCurrentStatus()).toBe(BoxWorkerStatus.PAUSE);
    });
  });

  it('Should toggle all workers correctly', () => {
    let workerState = null;
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});

    module['toggleAllWorkersForAllRooms'](true);

    expect(module['workerStore'].size).toBe(1);

    const worker = module['workerStore'].get('normal-room-id-1').worker;
    workerState = worker.getState();

    expect(workerState.status).toBe(BoxWorkerStatus.PAUSE);

    module['toggleAllWorkersForAllRooms'](false);

    workerState = worker.getState();
    expect(workerState.status).toBe(BoxWorkerStatus.INITIALIZING);
  });

  it('Should toggle one worker', () => {
    let workerState = null;

    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});

    expect(module['workerStore'].size).toBe(1);

    module['inst'].roomEngine.hasAnyInRoom = jest.fn(() => false);

    module['toggleWorkerForRoom']('normal-room-id-1');

    const worker = module['workerStore'].get('normal-room-id-1').worker;
    workerState = worker.getState();

    expect(workerState.status).toBe(BoxWorkerStatus.PAUSE);

    module['inst'].roomEngine.hasAnyInRoom = jest.fn(() => true);
    module['toggleWorkerForRoom']('normal-room-id-1');

    workerState = worker.getState();
    expect(workerState.status).toBe(BoxWorkerStatus.INITIALIZING);
  });
});


describe('TranscribeModule Initialization', () => {
  let module;

  const moduleSpy = {
    bindModuleEvents: jest.spyOn(TranscribeModule.prototype as any, 'bindModuleEvents'),
  };

  afterEach(async () => {
    await module.beforeDestruct();
    await module.destruct();

    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('Expect to initialize module when speech to text is enabled', async () => {
    
    module = new TranscribeModule(new MockMeeting('meeting', 'test-instance',
    new MockServerApi() as unknown as ServerAPI,
    new MockLogger() as unknown as Logger
    ) as unknown as Meeting);
    module['inst'].model.sessionSettings.speechToTextEnabled = true;
    await module.setup();

    expect(moduleSpy.bindModuleEvents).toBeCalled();
  });

  it('Expect to not initialize module correctly when speech to text is disabled', async () => {
    module = new TranscribeModule(new MockMeeting('meeting', 'test-instance',
    new MockServerApi() as unknown as ServerAPI,
    new MockLogger() as unknown as Logger
    ) as unknown as Meeting);
    module['inst'].model.sessionSettings.speechToTextEnabled = false;
    await module.setup();

    expect(moduleSpy.bindModuleEvents).not.toBeCalled();
  });

});
