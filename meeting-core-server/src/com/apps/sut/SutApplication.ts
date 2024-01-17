import { Application } from '../../utils/Application';
import { coreApi } from '../../utils/coreApiClient';
import Server from '../../utils/Server';
import BaseModule from '../meeting/modules/BaseModule';
import serverConfig from '../../utils/serverConfig';
import { AuthJwtFromRequest } from '../../gateway/manager';
import { AuthPayload, JwtSubjects } from '../../gateway/types';
import { Guard } from '../../gateway/decorators/class.decorator';
import { jwt, req, res, grants, client } from '../../gateway/decorators/argument.decorator';
import { Get, Socket, Post } from '../../gateway/decorators/method.decorator';
import config from 'config';
import * as jsonwebtoken from 'jsonwebtoken';
import Meeting from '../meeting/Meeting';
import { Attendee, Roles } from '@container/models';
import Client, { ClientState } from '../../utils/Client';
import { ServiceRegistry } from '../service-registrar/service-registry';
import { v4 } from 'uuid';
import { ServerRequest, ServerResponse } from '../../utils/Server';
import { ServerClient, ServerSocketIoClient } from '../../utils/ServerClient';
import WebSocket from 'ws';
import EventEmitter from 'events';
import { getValidInstance } from '../../utils/server-input-utils';
import { Socket as SocketIO } from 'socket.io';

@Guard([ JwtSubjects.CORE_API_SERVER ])
class SutModule extends BaseModule {
  /**
   * @url GET https://sock.<env>.meeting.com/sut/testing/test-module-endpoint-guarding
   *
   * check app module guarding
   */
  @Get('test-module-endpoint-guarding')
  private onTestModuleEndpointGuarding(@res res) {

    res.send(200, ['Ok', { self: this.constructor.name }]);
  }
}

Client.prototype['sut'] = function (sutAuth) {
  this.server.auth = sutAuth;
};

type SutClient = Client & {sut: (sutAuth: AuthPayload) => void};

class SutMeeting extends Meeting {
  async onConnect(client: Client): Promise<void> {
    if (client?.data.mode === 'sut' && !client.auth) {
      const now = new Date().getTime();
      const expTime = now + 60 * 60 * 24 * 1000;

      (client as SutClient).sut({
        aud: ['auth-code-client'],
        exp: expTime,
        iat: 0,
        iss: 'https://app.local.interactive.com/oauth/',
        jti: '',
        nbf: 0,
        uid: client.data.uid,
        sub: client.data.uid
      });


      client.state = ClientState.PENDING;
    }

    return super.onConnect(client);
  }

  async setupNewUser(attendeeData: Attendee, client?: Client) {
    if (client?.data.mode === 'sut') {
      attendeeData.id = client.data.aid = `sut-drone-${client.data.aid}`;
      attendeeData.firstName = 'SUT DRONE';
      attendeeData.lastName = `#${client.id}`;
      attendeeData.role = attendeeData.staticRole = Roles.ATTENDEE;
      attendeeData.userAccountID = attendeeData.id;

      // client.data.mode = null;
    }

    return super.setupNewUser(attendeeData, client);
  }

  protected sendLeftAttendeeInBuffer(data) {
    if (data.attendee.id.indexOf('sut-drone') === 0) {
      return;
    }

    super.sendLeftAttendeeInBuffer(data);
  }
}

// @Guard('*')
export default class SutApplication extends Application {
  private appManager: Server;

  private _runId = v4();

  get runId(): string {
    return this._runId;
  }

  async onConnect(client: Client) {
    if (client?.data.testing === 'split-session') {
      this.server.sendTo('join', {
        app: this.name,
        client: client.data,
        message: 'Welcome'
      });
    }

    return super.onConnect(client);
  }

  async setup() {
    this.appManager = this.conf('server');

    // override app meeting with extended version that is able to handle sut drones
    this.appManager.addApp('meeting', SutMeeting, undefined, {dependsOn: ['admin']});

    new SutModule(this as any);

    /**
     * @url POST https://sock.<env>.meeting.com/sut/testing/send-runtime-err body:{instId, aid, code, msg}
     *
     * disconnect specific user with specific error code
     */
    this.server.onPost('send-runtime-err', (req, res, params) => {
      const instances = this.appManager.getInsts();
      const instance = instances[params.instId];

      if (instance) {
        for (const [_, client] of instance.clients) {
          if (client.data.aid === params.aid) {
            this.appManager.disconnect(params.instId, client.id, params.code, params.msg);
            break;
          }
        }
      }
      res.send(200, 'Ok');
    });


    /**
     * @url GET https://sock.<env>.meeting.com/sut/testing/test-get-access-endpoint
     *
     * test get endpoint for access
     */
    this.server.onGet('test-get-access-endpoint', (req, res, params, grants) => {
      res.send(200, ['Ok', { params, grants, headers: req.headers }]);
    });

    /**
     * https://sock.<env>.meeting.com/sut/testing/test-post-access-endpoint
     *
     * test post endpoint for access
     */
    this.server.onPost('test-post-access-endpoint', (req, res, params, grants) => {
      res.send(200, ['Ok', { params, grants, headers: req.headers }]);
    });

    return super.setup();
  }

  /**
   * @url POST https://sock.<env>.meeting.com/sut/testing/test-token-socket-core-server
   *
   * get end point that check if socket server send auth token, validate it and return full information about it
   */
  @Get('test-token-socket-core-server')
  private async onTestTokenSocketCoreServer(@res res) {
    let req;

    try{
      const { request } = await coreApi.get('any-end-point');

      req = (request._currentRequest || request);
    } catch (err) {
      req = (err.request._currentRequest || err.request);
    }

    const headers = req.getHeaders();
    const token = AuthJwtFromRequest({ headers });

    try {
      const secretOrKey = Buffer.from(config.get('socketServerPortAuthorization.publicKey') as string, 'base64').toString('utf-8');
      const payload = jsonwebtoken.verify(token, secretOrKey) as AuthPayload;

      if (payload) {
        res.send(200, ['Pass', { payload, token }]);
      } else {
        res.send(406, ['Fail', { error: 'Payload is missing', headers }]);
      }
    } catch (err) {
      res.send(406, ['Fail', { error: err.message, headers }]);
    }
  }

  /**
   * @url POST https://sock.<env>.meeting.com/sut/testing/test-token-core-socket-server
   *
   * check if socket server see and validate token that is send from core api
   */
  @Post('test-token-core-socket-server')
  private async onTestTokenCoreSocketServer (@req req, @res res, params, @grants grants, @jwt payload) {
    if (payload) {
      res.send(200, ['Pass', { params, grants, payload, token: AuthJwtFromRequest(req)}]);
    } else {
      res.send(406, ['Fail', { params, grants, headers: req.headers }]);
    }
  }

  /**
   * @url GET https://sock.<env>.meeting.com/sut/testing/test-private-endpoint
   *
   * test private endpoint that allows only subject -core-api
   */
  @Get('test-private-endpoint', [ JwtSubjects.CORE_API_SERVER ])
  private onTestPrivateEndpoint (@req req, @res res, params, @grants grants, @jwt payload) {
    if (payload) {
      res.send(200, ['Pass', { params, grants, payload, token: AuthJwtFromRequest(req)}]);
    } else {
      res.send(406, ['Fail', { params, grants, headers: req.headers }]);
    }
  }

  /**
   * @url POST https://sock.<env>.meeting.com/sut/testing/check-socket-server-config
   *
   * get end point that check if socket server send auth token, validate it and return full information about it
   */
  @Get('check-socket-server-config')
  private async onCheckSocketServerConfig (@res res) {
    res.send(200, [ 'Ok', serverConfig.CONFIG ]);
  }

  @Get('index')
  private onIndex(@res res) {
    res.send(200, [
      {
        url: 'POST https://sock.<env>.meeting.com/sut/testing/send-runtime-err body:{instId, aid, code, msg}',
        info: 'disconnect specific user with specific error code'
      },
      {
        url: 'GET https://sock.<env>.meeting.com/sut/testing/test-get-access-endpoint',
        info: 'test get endpoint for access'
      },
      {
        url: 'POST https://sock.<env>.meeting.com/sut/testing/test-post-access-endpoint',
        info: 'test post endpoint for access'
      },
      {
        url: 'GET https://sock.<env>.meeting.com/sut/testing/test-token-socket-core-server',
        info: 'get end point that check if socket server send auth token, validate it and return full information about it'
      },
      {
        url: 'POST https://sock.<env>.meeting.com/sut/testing/test-token-core-socket-server',
        info: 'check if socket server see and validate token that is send from core api'
      },
      {
        url: 'POST https://sock.<env>.meeting.com/sut/testing/check-socket-server-config',
        info: 'get current socket server configuration'
      },
      {
        url: 'GET https://sock.<env>.meeting.com/sut/testing/test-module-endpoint-guarding',
        info: 'check app module guarding'
      },
      {
        url: 'GET https://sock.<env>.meeting.com/sut/testing/test-private-endpoint',
        info: 'test private endpoint that allows only subject -core-api'
      },
      {
        url: 'WSS wss://sock.<env>.meeting.com/sut/testing/test-ws-endpoint',
        info: 'test ws end points (currently jwt does not support)'
      },
    ]);
  }

  @Socket('test-ws-endpoint')
  private onTestSocketGateway (@client client, @grants grants, @req req, data, @jwt jwt) {
    console.log('onSocketGateway is invoked');

    client.send('Ok', data);
  }

  @Post('test-post-endpoint')
  private onTestPostGateway (@jwt payload, params, @res res, ...rest) {
    console.log('onTestPostGateway is invoked', { params, payload, self: this.constructor.name });

    res.send(200, ['Nice']);
  }

  /// 

  async getActiveMeetingServiceData() {
    return {
      'X-ACTIVE-MEETING-SERVICE-INSTANCE': ServiceRegistry.getMeetingServiceInstance,
      'X-ACTIVE-MEETING-SERVICE-NAME': ServiceRegistry.getMeetingServiceName,
      'X-ACTIVE-MEETING-SERVICE-RUN-ID': ServiceRegistry.getMeetingServiceRunID,
      'X-ACTIVE-MEETING-SERVICE-INSTANCE-RUN-ID': ServiceRegistry.getMeetingServiceInstanceRunID,
      'X-ACTIVE-MEETING-SERVICE-IPV4': await ServiceRegistry.getMeetingServiceIP(),
    }
  }

  getActiveMeetingData() {
    return {
      'X-ACTIVE-MEETING-ID': this.name,
      'X-ACTIVE-MEETING-RUN-ID': this.runId,
    }
  }

  @Get('GET_MEETING_INFO')
  public async getMeetingInfo(@res res: ServerResponse, params: {}) {
    res.send(200, {
      ServiceInfo: {
        ...await this.getActiveMeetingServiceData()
      },
      ...this.getActiveMeetingData()
    })
    res.end();
  }

  @Socket('GET_MEETING_INFO')
  async socketGetMeetingInfo(@client client: Client) {
    console.log('CLIENT - GET_MEETING_INFO');
    this.server.sendTo("GET_MEETING_INFO", { ServiceInfo: { ...await this.getActiveMeetingServiceData() }, ...this.getActiveMeetingData() });
  }

  @Get('test-send-to')
  private testSendTo(params, @req req, @res res) {
    const load = params.conn || 1000;
    const sendToIds = [];

    const numberOfSendMessages = 1000;

    const thisInst = this.appManager.getAppInstanceByName(this.type, this.name);

    for (let i=0; i < load; i++) {
      const wsEmu = new EventEmitter();
      
      (wsEmu as any).connected = true;
      (wsEmu as any).handshake = {query: {}};
  
      (wsEmu as any).send = () => { };
      (wsEmu as any).disconnect = () => { };

      const client = new ServerSocketIoClient(req, wsEmu as unknown as SocketIO, this.type, this.name);
      
      sendToIds.push(client.id);

      thisInst.addClient(client);
    }

    const testStartTime = Date.now();

    for (let i = 0; i < numberOfSendMessages; i++) {
      this.server.sendTo('send-to-that-end-point', {some: 'data'}, sendToIds);
    }

    const testStopTime = Date.now();
    const calcTime = testStopTime - testStartTime;

    // clear 
    for (const id of sendToIds) {
      thisInst.removeClient(id);
    }

    res.send(200, [`Res of the test: ${calcTime / 1000} secs for ${load}`]);
  }

  @Get('test-inject-attendees-to-session')
  private async testInjectAttendeesToSession(params, @req req, @res res) {
    const load = params.conn || 1000;

    const thisInst = await getValidInstance(this.appManager, 'meeting', params.session || '5ccf6b6e-d5d4-4310-b442-3c4ee3e62e75', {grants: 'meeting'}, true);

    for (let i=0; i < load; i++) {
      const wsEmu = new EventEmitter();
      
      (wsEmu as any).connected = true;
      (wsEmu as any).handshake = {query: {}};
  
      (wsEmu as any).send = () => { };
      (wsEmu as any).disconnect = () => { };

      const client = new ServerSocketIoClient(req, wsEmu as unknown as SocketIO, this.type, this.name);
      client.data = {
        aid: 1,
        mode: 'sut'
      }
      
      thisInst.addClient(client);
      thisInst.app.onConnect(client.client);
    }

    res.send(200, [`Good`]);
  }

  @Get('test-send-to-room')
  private async testSendToRoom(params, @req req, @res res) {
    const numberOfSendMessages = 1000;

    const thisInst = this.appManager.getAppInstanceByName('meeting', params.session || '5ccf6b6e-d5d4-4310-b442-3c4ee3e62e75');
    const saveOriginMethod = thisInst.sendTo;

    // isolate for the test
    thisInst.sendTo = () => {};

    const testStartTime = Date.now();

    for (let i = 0; i < numberOfSendMessages; i++) {
      (thisInst.app as Meeting).roomEngine.sendToRoom(params.room, 'send-to-that-end-point', {some: 'data'});
    }
    const testStopTime = Date.now();
    const calcTime = testStopTime - testStartTime;

    thisInst.sendTo = saveOriginMethod;

    res.send(200, [`Res of the test: ${calcTime / 1000} secs`]);
  }
}
