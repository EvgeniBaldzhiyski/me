jest.mock('../database', () => null);
jest.mock('elastic-apm-node/start');

import { ErrorCodes } from '@container/models';
import { ApplicationLifeCycleState } from './Application';
import { httpInput } from './server-http-input';

describe('server http input', () => {
  let handler;
  let instance;
  let app;
  let server;
  let res;
  let req;

  beforeAll(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  beforeEach(() => {
    handler = jest.fn();
    instance = {
      app: {
        isActive: jest.fn(() => true)
      },
      get: { 'test-endpoint': handler },
      post: { 'test-endpoint': handler },
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
        if (appAlias === 'test-app' && instAlias === 'test-inst') {
          return instance;
        }

        return null;
      }),

      ensureInstance: jest.fn((appAlias, instAlias) => {
        return instance;
      }),

      logger: {
        error: () => null,
        info: () => null,
        debug: () => null,
        log: () => null,
      }
    };

    res = {
      send: jest.fn(),
      end: jest.fn(),
      header: jest.fn(),
    };

    req = {
      url: '',
      headers: { 'x-real-ip': '0.0.0.0' }
    };
  });

  it('correct url', async () => {
    await httpInput(server as any, {...req, url: '/test-app/test-inst/test-endpoint' } as any, res as any, 'get', () => null);

    expect(server.getApp).toBeCalledWith('test-app');
    expect(server.getAppInstanceByName).toBeCalledWith('test-app', 'test-inst');
    expect(server.ensureInstance).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalled();
  });

  it('auto create app', async () => {
    await httpInput(server as any, {...req, url: '/test-app/default/test-endpoint' } as any, res as any, 'get', () => null);

    expect(server.getApp).toBeCalledWith('test-app');
    expect(server.getAppInstanceByName).toBeCalledWith('test-app', 'default');
    expect(server.ensureInstance).toBeCalledWith('test-app', 'default');
    expect(handler).toHaveBeenCalled();
  });

  it('app is missing', async () => {
    await httpInput(server as any, {...req, url: '/wrong-app/default/test-endpoint' } as any, res as any, 'get', () => null);

    expect(res.send).toBeCalledWith(ErrorCodes.FORBIDDEN, expect.anything());
    expect(handler).not.toHaveBeenCalled();
  });

  it('session not started', async () => {
    await httpInput(server as any, {...req, url: '/test-app/any-inst/test-endpoint' } as any, res as any, 'get', () => null);

    expect(res.send).toBeCalledWith(ErrorCodes.SESSION_NOT_STARTED, expect.anything());
    expect(handler).not.toHaveBeenCalled();
  });

  it('app is broken', async () => {
    server.ensureInstance = () => { throw '' };

    await httpInput(server as any, {...req, url: '/test-app/default/test-endpoint' } as any, res as any, 'get', () => null);

    expect(res.send).toBeCalledWith(ErrorCodes.BROKEN_APPLICATION, expect.anything());
    expect(handler).not.toHaveBeenCalled();
  });
});
