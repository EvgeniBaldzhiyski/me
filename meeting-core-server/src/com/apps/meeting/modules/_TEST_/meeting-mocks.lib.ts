export class MockDefaultDbFactory {
  collection() {
    return { createIndex: jest.fn() };
  }
}

export class MockCreateMongoDbStateManagerFactory {
  saveState() { return Promise.resolve(); }
  loadState() { return Promise.resolve(); }
  deleteState() { return Promise.resolve(); }
}

jest.mock('../../../../gateway/manager', () => {
  return {
    gatewayScanner: jest.fn(),
  };
});
jest.mock('mongodb');
jest.mock('elastic-apm-node/start');
jest.mock('elastic-apm-http-client');
jest.mock('@container/apm-utils', () => {
  return {
    ApmSpan: () => { return () => {}},
    ApmTransaction: () => { return () => {}},
    TransactionType: { WS_REQUEST: null }
  };
});
jest.mock('../../../../database/MongoDbStateManager', () => {
  return {
    __esModule: true,
    createMongoDbStateManager: jest.fn(() => (new MockCreateMongoDbStateManagerFactory)),
  };
});
jest.mock('../../../../database/db.connection', () => {
  return {
    __esModule: true,
    defaultDb: jest.fn(() => (new MockDefaultDbFactory)),
  };
});

import { Attendee, Model } from '@container/models';
import EventEmitter from 'events';
import { Application } from '../../../../utils/Application';
import ServerAPI from '../../../../utils/ServerAPI';
import { Logger } from 'winston';
import Meeting from '../../Meeting';
import { BaseModuleInterface, BaseModuleInterfaceStatic } from '../BaseModule';
import { Observable, of, Subject } from 'rxjs';
import { VoiceGatewayEvent, VoiceGatewayEventType } from '../box-system/voice/voice.interfaces';
import { AttendeeStorage } from '../../utils/attendee.storage';
import { ConnectionStorage } from '../../utils/connection.storage';


export class MockRoomEngine {
  hasAnyPresenter = true;

  getRoomById() {}
  sendToRoomWithFallback() {}
  hasAnyInRoom() { return true; }
  isHost() { return true; }
  isCoHost() { return true; }
  sendToRoom() {return true; }
  sendToMainPresenters() {return true; }
  sendToRoomMainPresentersWithFallback() {return true; }
}

export class MockUpdateEngine {
  registerApprover() { return Promise.resolve(); }
  updateAttendee() { return Promise.resolve(); }
  approveAndApplyData() { return Promise.resolve(); }
}

export class MockServerApi {
  clients = new Map;
  onSocket(name, handler) {}
  onGet(name, handler) {}
  onPost(name, handler) {}
  sendTo() {}
}

export class MockConnectionStorage {
  destruct() {}
  addUpdateConnection() { }
  removeConnection() {}
  getAttendeeId() {}
  getClientId() {}
  hasAttendeeConnection() {}
  getAttendeeConnection() {}
  isAttConnBlocked() {}
}

export class MockAttendeeStorage {
  destruct() { }
  addAttendee() {}
  removeAttendee() {}
  updateAttendee() {}
  getAttendee() {}
  getAttendeeList() {}
  getAttendees() {}
  getAttendeeById() {}
  getAttendeeByUserAccountId() {}
  getAttendeeListByRoomId() {}
  getAttendeeMapByRoomId() {}
  getAttendeesByRole() { }
}

export class MockLogger {
  error() {}
  warn() {}
  log() {}
  info() {}
  debug() {}
  isInfo() {} 
  isError() {}
  isWarn() {}
  isDebug() {}
}

export const MockCoreApiObservable = {
  post: () => {
    return of({ status: 200, statusText: 'all good' });
  },
  get: () => {}
};

export class MockMeeting extends Application {
  roomEngine = new MockRoomEngine();
  updateEngine = new MockUpdateEngine();
  model = new Model();
  eventBus = new EventEmitter();

  attendeeStorage: AttendeeStorage;
  connectionStorage: ConnectionStorage;

  constructor(
    public readonly type: string,
    public readonly name: string,
    public readonly server: ServerAPI,
    public readonly logger: Logger,
    protected _config = {}
  ) {
    super(type, name, server, logger);

    this.attendeeStorage = new AttendeeStorage(this as unknown as Meeting);
    this.connectionStorage = new ConnectionStorage(this as unknown as Meeting);
  }

  fetchAttendeeInfo() {
    return Promise.resolve(new Attendee());
  }
  setupNewUser() { return Promise.resolve(); }
  sendToAttendee() {}

  removeAttendee() {}

  setupRemoveAttendeeDelay() {}
  clearRemoveAttendeeDelay() {}
}

export function createModule<R extends BaseModuleInterface = BaseModuleInterface>(module): R {
  return new module(
    new MockMeeting('meeting', 'test-instance',
      new MockServerApi() as unknown as ServerAPI,
      new MockLogger() as unknown as Logger
    ) as unknown as Meeting
  );
}

