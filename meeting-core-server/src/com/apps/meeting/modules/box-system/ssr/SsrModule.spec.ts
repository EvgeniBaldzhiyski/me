import { Attendee, Model, Room, ServerConnectionAPI, SessionSettings } from '@container/models';
import { BoxWorkerStatus } from '@container/models';
import Client from '../../../../../utils/Client';
import { BoxWorker } from '../utils/workers/box.worker';
import { Subscription } from 'rxjs';
import { BoxWorkerMongodbSchema } from '../utils/workers/box.worker.interface';
import SsrModule from './SsrModule';
import { SsrWorker } from './ssr.worker';
import { SsrWorkerPayload } from './ssr.worker.interface';
import { createModule, MockMeeting, MockServerApi } from '../../_TEST_/meeting-mocks.lib';

jest.mock('mongodb');
jest.mock('elastic-apm-node/start');
jest.mock('elastic-apm-http-client');
jest.mock('../../../../../gateway/manager', () => {
  return {
    gatewayScanner: () => jest.fn()
  };
});
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
    ssrFactoryPromise: {
      start: Promise.resolve()
    }
  };
});

// jest.useFakeTimers();

describe('SsrModule', () => {
  let module: SsrModule;

  const moduleSpy = {
    bindModuleEvents: jest.spyOn(SsrModule.prototype as any, 'bindModuleEvents'),
    startWorkerEndpoint: jest.spyOn(SsrModule.prototype as any, 'startWorkerEndpoint'),
    stopWorkerEndpoint: jest.spyOn(SsrModule.prototype as any, 'stopWorkerEndpoint'),
    startWorker: jest.spyOn(SsrModule.prototype as any, 'startWorker'),
    stopWorker: jest.spyOn(SsrModule.prototype as any, 'stopWorker'),
    onWorkerStateChange: jest.spyOn(SsrModule.prototype as any, 'onWorkerStateChange'),
    destroyWorker: jest.spyOn(SsrModule.prototype as any, 'destroyWorker'),
  };

  const spySendTo = jest.spyOn(MockServerApi.prototype, 'sendTo');

  const workerSpy = {
    start: jest.spyOn(BoxWorker.prototype, 'start'),
    stop: jest.spyOn(BoxWorker.prototype, 'stop'),
  };

  beforeEach(async () => {
    module = createModule(SsrModule);
    await module.setup();
    (module['inst'] as any).model = {
      ...(new Model()),
      attendee: new Attendee(),
      sessionSettings: new SessionSettings({allowRecording: true, breakoutRoomRecording: true}),
      roomsIndex: {
               'normal-room-id-1': {id: 'normal-room-id-1', isTestRoom: false, nameRecording: 'test-auto-gen-title-1'} as Room,
               'normal-room-id-2': {id: 'normal-room-id-2', isTestRoom: false, nameRecording: 'test-auto-gen-title-2'} as Room,
               'test-room-id': {id: 'test-room-id', isTestRoom: true, } as Room
        }
    }
  });

  afterEach(async () => {
    await module.beforeDestruct();
    await module.destruct();
    jest.clearAllMocks();
    jest.clearAllTimers();
    module = undefined;
  });

  it('Should create and start worker', async () => {
    const client = {data: {id: 'any-id',aid: 'any-aid', send: () => null}} as Client;
    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1', title: 'test-recording-title'});
    expect(moduleSpy.startWorkerEndpoint).toBeCalled();
    expect(workerSpy.start).toBeCalled();
    expect(moduleSpy.onWorkerStateChange).toBeCalled();
    expect(module['workerStore'].size).toBe(1);
    expect(module['playlistsMap'].size).toBe(1);

    expect(module['workerStore'].get('normal-room-id-1')).toMatchObject({
      worker: expect.any(SsrWorker),
      subscriptions: expect.any(Subscription)
    });
  });

  it('Should create and start worker with auto generated name', async () => {
    const client = {data: {aid: 'any-aid', send: () => null}} as Client;

    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1'});

    expect(moduleSpy.startWorkerEndpoint).toBeCalled();
    expect(workerSpy.start).toBeCalled();
    expect(moduleSpy.onWorkerStateChange).toBeCalled();
    expect(module['workerStore'].size).toBe(1);
    expect(module['playlistsMap'].size).toBe(1);

    const worker = module['workerStore'].get('normal-room-id-1').worker;
    const workerState = worker.getState();

    expect(workerState).toMatchObject({
      id: 'normal-room-id-1',
      status: BoxWorkerStatus.INITIALIZING,
      title: 'test-auto-gen-title-1'
    });
  });

  it('Should start or ignore in cases for authorization check', () => {
    jest.spyOn(module['inst'].roomEngine, 'isHost').mockImplementation(() => false);
    jest.spyOn(module['inst'].roomEngine, 'isCoHost').mockImplementation(() => false);
    module['startWorkerEndpoint']({data: {id: 'any-id',aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});
    expect(module['workerStore'].size).toBe(0);

    jest.spyOn(module['inst'].roomEngine, 'isHost').mockImplementation(function() {return true; });
    module['startWorkerEndpoint']({data: {id: 'any-id',aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});
    expect(module['workerStore'].size).toBe(1);
  });

  it('Should create and stop worker', () => {
    jest.spyOn(module['inst'].roomEngine, 'isHost').mockImplementation(() => true);
    jest.spyOn(module['inst'].roomEngine, 'isCoHost').mockImplementation(() => true);
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});
    module['stopWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});

    expect(moduleSpy.stopWorkerEndpoint).toHaveBeenCalled();
    expect(workerSpy.stop).toHaveBeenCalled();
    expect(moduleSpy.onWorkerStateChange).toBeCalledTimes(2); // 1 for start , 1 for stop
    expect(moduleSpy.destroyWorker).toBeCalledTimes(1);

    expect(module['workerStore'].size).toBe(0);
    expect(module['playlistsMap'].size).toBe(0);

  });

  it('Should create and stop/pause worker with correct playlist', () => {
    jest.spyOn(module['inst'].roomEngine, 'isHost').mockImplementation(() => true);
    jest.spyOn(module['inst'].roomEngine, 'isCoHost').mockImplementation(() => true);
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});

    const playlistIdFirst = String(module['workerStore'].get('normal-room-id-1').worker.payload.playlistId);
    module['stopWorker']('normal-room-id-1', true);

    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});

    const playlistIdSecond = String(module['workerStore'].get('normal-room-id-1').worker.payload.playlistId);

    expect(playlistIdFirst).toBe(playlistIdSecond);

    module['stopWorker']('normal-room-id-1');

    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'normal-room-id-1'});

    const playlistIdThird = String(module['workerStore'].get('normal-room-id-1').worker.payload.playlistId);

    expect(playlistIdFirst).not.toBe(playlistIdThird);
    expect(playlistIdSecond).not.toBe(playlistIdThird);
  });

  it('Should create only one worker', async () => {
    const client = {data: {aid: 'any-aid', send: () => null}} as Client;
    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1'});
    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1'});

    expect(moduleSpy.startWorkerEndpoint).toBeCalledTimes(2);
    expect(workerSpy.start).toBeCalledTimes(1);
    expect(moduleSpy.onWorkerStateChange).toBeCalledTimes(1);
    expect(module['workerStore'].size).toBe(1);
    expect(module['playlistsMap'].size).toBe(1);
  });

  it('Should ignore if target room is test', () => {
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {id: 'test-room-id'});

    expect(module['workerStore'].size).toBe(0);
    expect(module['playlistsMap'].size).toBe(0);
  });

  it('Should ignore if no target room', () => {
    module['startWorkerEndpoint']({data: {aid: 'any-aid'}} as Client, {} as { id: Room['id'] });

    expect(module['workerStore'].size).toBe(0);
    expect(module['playlistsMap'].size).toBe(0);
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
      ServerConnectionAPI.GET_SSR_STATE,
      {id: 'normal-room-id-1', status: BoxWorkerStatus.STOP},
      client.id
    );
  });

  it('Should get state properly of worker in progress ', () => {
    const client = {data: {aid: 'any-aid'}, send: jest.fn()} as unknown as Client;

    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1', title: 'test-video-title'});
    module['getWorkerStateEndpoint'](client, {id: 'normal-room-id-1'});

    expect(spySendTo).toBeCalledWith(
      ServerConnectionAPI.GET_SSR_STATE,
      {
        id: 'normal-room-id-1',
        status: BoxWorkerStatus.INITIALIZING,
        title: 'test-video-title'
      },
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
    const workersMongoState = {workers: [{id: 'normal-room-id-1'}, {id: 'normal-room-id-2'}]} as BoxWorkerMongodbSchema<SsrWorkerPayload>;

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

    module['inst'].roomEngine.hasAnyInRoom = jest.fn((_rid: string) => false);

    module['toggleWorkerForRoom']('normal-room-id-1');

    const worker = module['workerStore'].get('normal-room-id-1').worker;
    workerState = worker.getState();

    expect(workerState.status).toBe(BoxWorkerStatus.PAUSE);

    module['inst'].roomEngine.hasAnyInRoom = jest.fn((_rid: string) => true);

    module['toggleWorkerForRoom']('normal-room-id-1');

    workerState = worker.getState();
    expect(workerState.status).toBe(BoxWorkerStatus.INITIALIZING);
  });

  it('Should start the recording when room auto-recording is enabled', () => {
    module['inst'].model.roomsIndex['normal-room-id-1'].autoRecording = true;
    module['inst'].model.roomsIndex['normal-room-id-2'].autoRecording = true;

    const rooms = [
      {id: 'normal-room-id-1'} as Room,
      {id: 'normal-room-id-2'} as Room
    ];

    module['initiateAutoRecording'](rooms);

    expect(moduleSpy.onWorkerStateChange).toBeCalledTimes(2);
  });

  it('Should start the recording when room auto-recording is enabled and people in room', () => {
    module['inst'].model.roomsIndex['normal-room-id-1'].autoRecording = true;
    module['inst'].model.roomsIndex['normal-room-id-2'].autoRecording = true;
    const rooms = [
      {id: 'normal-room-id-1'} as Room,
      {id: 'normal-room-id-2'} as Room
    ];

    module['inst'].roomEngine.hasAnyInRoom = jest.fn((rid: string) => {
      return rid !== 'normal-room-id-2';
    });

    module['initiateAutoRecording'](rooms);
    
    module['inst'].roomEngine.hasAnyInRoom = jest.fn((_rid: string) => true);
    expect(moduleSpy.onWorkerStateChange).toBeCalledTimes(1);
  });

  it('Should start the recording when room auto-recording is enabled and no recording in progress', () => {
    module['inst'].model.roomsIndex['normal-room-id-1'].autoRecording = true;
    module['inst'].model.roomsIndex['normal-room-id-2'].autoRecording = true;

    const client = {data: {aid: 'any-aid', send: () => null}} as Client;

    module['startWorkerEndpoint'](client, {id: 'normal-room-id-1', title: 'test-recording-title'});

    expect(moduleSpy.startWorkerEndpoint).toBeCalledTimes(1);
    expect(moduleSpy.onWorkerStateChange).toBeCalledTimes(1);
    expect(workerSpy.start).toBeCalledTimes(1);

    const rooms = [
      {id: 'normal-room-id-1'} as Room,
      {id: 'normal-room-id-2'} as Room
    ];
    module['initiateAutoRecording'](rooms);

    expect(moduleSpy.onWorkerStateChange).toBeCalledTimes(2); // 1 for the start call, 1 for the initiateCall
    expect(workerSpy.start).toBeCalledTimes(2); // 1 for the start call, 1 for the initiateCall
    expect(workerSpy.stop).not.toHaveBeenCalled();
  });
});
