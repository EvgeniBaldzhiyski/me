jest.mock('elastic-apm-node/start');
jest.mock('elastic-apm-http-client');

import serverConfig from './serverConfig';
import { ServerClient} from './ServerClient';
import WebSocket from 'ws';
import { AuthPayload } from '../gateway/types';
import EventEmitter from 'events';

jest.useFakeTimers();

let conn;
let req;
let client: ServerClient;
class MockConnection extends EventEmitter {
  readyState = WebSocket.OPEN;

  _message = null;
  _error = null;
  _close = null;

  ping = jest.fn(() => {
    setTimeout(() => this.emit('pong'));
  });
  send = jest.fn();
  close =  jest.fn();
}

describe('ServerClient testing', () => {
  beforeAll(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  beforeEach(() => {
    req = {
      url: '',
      headers: {},
      connection: { remoteAddress: '0.0.0.0' }
    };

    conn = new MockConnection;

    client = new ServerClient(req, conn, 'meeting', 'testing-session-id');
    client.auth = { exp: 0 } as AuthPayload;
  });

  it('basic', async () => {
    expect(conn.ping).not.toBeCalled();

    jest.advanceTimersByTime((serverConfig.CONFIG.socketServerConfig.keepAliveInterval * 1000) * 2);
    expect(conn.ping).toBeCalledTimes(2);

    client.send('test-method', 'test-data');
    expect(conn.send).toBeCalledWith(
      expect.stringMatching(/"method":"test-method","data":"test-data"/)
    );

    conn.send.mockClear();
    client.active = false;
    client.sendError(1, 'test-error-message');
    expect(conn.send).toBeCalled();

    conn.send.mockClear();
    client.send('test-method', 'test-data');
    expect(conn.send).not.toBeCalled();

    conn.send.mockClear();
    client.active = true;
    client.close(1);
    expect(conn.send).toBeCalledTimes(1);
    expect(conn.close).toBeCalledTimes(1);
  });
});
