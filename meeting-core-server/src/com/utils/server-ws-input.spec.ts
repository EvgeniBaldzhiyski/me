jest.mock('../database', () => null);
jest.mock('elastic-apm-node/start');

class MockClientApi {
  constructor(private server) { }

  get data() { return this.server.data; }

  send(method, data) { this.server.send(method, data); }
}

class MockServerClient {
  _data: {};

  client;

  constructor() {
    this.client = new MockClientApi(this);
  }

  active = true;

  get data() { return this._data; }
  set data(value) { this._data = value; }

  send () {}
  sendError () {}
  close () {}
}

jest.mock('./ServerClient', () => {
  return {
    ServerClient: MockServerClient
  };
});

import { ErrorCodes, MessagePackage } from '@container/models';
import { ApplicationLifeCycleState } from './Application';
import { webSocketInput } from './server-ws-input';

describe('server http input', () => {
  let handler;
  let instance;
  let app;
  let server;
  let conn;
  let req;

  beforeAll(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  beforeEach(() => {
    handler = jest.fn();
    instance = {
      app: {
        isActive: jest.fn(() => true),
        onConnect: jest.fn(),
        onDisconnect: jest.fn(),
        onSocketBefore: jest.fn(() => true),
      },
      socket: { 'test-endpoint': handler },

      addClient: jest.fn(),
      removeClient: jest.fn(),
    };
    app = {
      defname: 'default',
    };

    server = {
      getApp: jest.fn(appAlias => {
        if (appAlias === 'test-app') {
          return app;
        }

        return null;
      }),

      getAppInstanceByName: jest.fn((appAlias, instAlias) => {
        return null;
      }),

      ensureInstance: jest.fn((appAlias, instAlias) => {
        return instance;
      }),

      shutdownInst: jest.fn(),

      logger: {
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
      }
    };

    req = {
      url: '',
      headers: {},
      connection: { remoteAddress: '0.0.0.0' }
    };

    conn = {
      _message: null,
      _error: null,
      _close: null,

      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn((name, callback) => { conn[`_${name}`] = callback; }),
      off: jest.fn(),
    };
  });

  it('correct url', async () => {
    await webSocketInput(server as any, conn as any, {...req, url: '/test-app/test-inst?param1=1&param2=2' } as any);

    conn._message(MessagePackage.stringify(new MessagePackage('test-endpoint', 'any data')));

    expect(server.getApp).toBeCalledWith('test-app');
    expect(server.ensureInstance).toBeCalledWith('test-app', 'test-inst');
    expect(server.ensureInstance).toReturnWith(instance);

    expect(instance.addClient).toBeCalledWith( expect.objectContaining({
      data: expect.objectContaining({param1: '1'}),
    }));
    expect(instance.app.onConnect).toBeCalledWith( expect.objectContaining({
      data: expect.objectContaining({param1: '1'}),
    }));

    expect(handler).toHaveBeenCalled();
  });

  it('app is missing', async () => {
    const spy = jest.spyOn(MockServerClient.prototype, 'close');
    await webSocketInput(server as any, conn as any, {...req, url: '/wrong-app/default' } as any);

    expect(spy).toBeCalledWith(ErrorCodes.KILL, expect.objectContaining({
      errno: ErrorCodes.FORBIDDEN,
    }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('endpoint is missing', async () => {
    const spy = jest.spyOn(MockServerClient.prototype, 'sendError');
    await webSocketInput(server as any, conn as any, {...req, url: '/test-app/default' } as any);

    conn._message(MessagePackage.stringify(new MessagePackage('wrong-endpoint', 'any data')));

    expect(spy).not.toBeCalledWith(ErrorCodes.BAD_PARAMS, expect.anything());
    expect(handler).not.toHaveBeenCalled();
  });
});
