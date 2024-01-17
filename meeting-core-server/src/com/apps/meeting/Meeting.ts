import apm from 'elastic-apm-node/start';
import {
  Attendee,
  AttendeeAttributesUsingOtherCases,
  AttendeeBase,
  ClientConnectionAPI,
  ConnectionStatus,
  ErrorCodes,
  MessagePackage,
  Model,
  RestAPI,
  Roles,
  ServerConnectionAPI,
  WhiteboardAction
} from '@container/models';
import { ApmSpan, ApmTransaction, FunctionalDomainType, TransactionType } from '@container/apm-utils';
import { EventEmitter } from 'events';
import { Application, ApplicationLifeCycleState } from '../../utils/Application';
import Client, { ClientState } from '../../utils/Client';
import {
  AttendeeFirstJoinSuccessEvent,
  AttendeeJoinSuccessEvent,
  AttendeeLeftAfterKickOut,
  AttendeeLeftAfterTimeoutEvent,
  AttendeeLeftEvent,
  NoMainPresenterEvent,
  NoMainPresenterTimeoutEvent,
  SessionCloseEvent,
  SessionInitEvent
} from './events/SessionEvents';
import { BaseModuleInterface, BaseModuleInterfaceStatic } from './modules/BaseModule';
import config from 'config';

import AdminEngine from './modules/AdminEngine';
import BatonEngine from './modules/BatonEngine';
import RoomEngine from './modules/RoomEngine';
import UpdateEngine from './modules/UpdateEngine';
import serverConfig from '../../utils/serverConfig';
import ChatModule from './modules/chat/ChatModule';
import VideoModule from './modules/video/VideoModule';
import AudioModule from './modules/audio/AudioModule';
import PresentationModule from './modules/presentation/PresentationModule';
import WebrtcSignalingModule from './modules/webrtc-signaling/WebrtcSignalingModule';
import LaserPointerModule from './modules/laser-pointer/LaserPointerModule';
import SharingModule from './modules/sharing/SharingModule';
import AttendeeModule from './modules/attendee/AttendeeModule';
import EmojisModule from './modules/emojis/EmojisModule';
import TimersModule from './modules/timers/TimersModule';
import InstantPollModule from './modules/polls/InstantPollModule';
import ExportingEngine from './modules/exporting/ExportingEngine';
import NoteModule from './modules/note/NoteModule';
import MediaRecorderModule from './modules/video/MediaRecorderModule';
import SurveyModule from './modules/survey/SurveyModule';
import EventLogModule from './modules/event-log/EventLogModule';
import uuid from 'uuid';
import { coreApi } from '../../utils/coreApiClient';
import { AxiosError } from 'axios';
import { meetingRunGauge } from '../../metrics/metrics';
import { Logger } from 'winston';
import AssetsEngine from './engines/assets/assets.engine';
import LayoutEngine from './engines/layout/layout.engine';
import { Socket } from '../../gateway/decorators/method.decorator';
import { client } from '../../gateway/decorators/argument.decorator';
import DirectChatHistoryModule from './modules/chat/DirectChatHistoryModule';
import { AppInstanceMessagingEvents } from '../../utils/AppInstance';
import StatisticsEngine from './engines/statistics/statistics.engine';
import TranscribeModule from './modules/box-system/transcribe/TranscribeModule';
import SsrModule from './modules/box-system/ssr/SsrModule';
import VoiceModule from './modules/box-system/voice/voice.module';
import { rejectConnection } from '../utils/shared';
import { ConnectionStorage } from './utils/connection.storage';
import { AttendeeStorage } from './utils/attendee.storage';

const modules: Record<string, BaseModuleInterfaceStatic> = {
  // @TODO -  it is good idea to put on top one module that will subscribe for attendee update requests and
  // @TODO - will prevent from invalidate requests the second modules. This will solve the performance and order validation problems.
  'ChatModule': ChatModule,
  'DirectChatHistoryModule': DirectChatHistoryModule,
  'VideoModule': VideoModule,
  'AudioModule': AudioModule,
  'PresentationModule': PresentationModule,
  'WebrtcSignaling': WebrtcSignalingModule,
  'LaserPointer': LaserPointerModule,
  'SharingModule': SharingModule,
  'AttendeeModule': AttendeeModule,
  'SurveyModule': SurveyModule,
  'EmojisModule': EmojisModule,
  'TimersModule': TimersModule,
  'NoteModule': NoteModule,
  'InstantPollModule': InstantPollModule,
  'EventLogModule': EventLogModule,
  'TranscribeModule': TranscribeModule,
  'SsrModule': SsrModule,
  'VoiceModule': VoiceModule,
  'MediaRecorderModule': MediaRecorderModule,
};

export declare type AttendeeAuthResponse = (
  Pick<
    AttendeeBase & AttendeeAttributesUsingOtherCases,
    (
      'id' |
      'email' |
      'firstName' |
      'lastName' |
      'role' |
      'latitude' |
      'longitude' |
      'avatar' |
      'image' |
      'phoneCode' |
      'externalAttID' |
      'utcOffset'
    )
  > &
  {
    kickoutTimestamp: number | null,
    kickoutReason: string | null
  }
);

class MeetingInitError extends Error { }

export default class Meeting extends Application {
  /**
   * give 5 secs delay if attendees if they are able to come back
   *
   * @param {NodeJS.Timer[]}
   */
  protected disconnectDelay = {} as Record</* msgTypeForAttendee as */ string, NodeJS.Timer>;

  protected _modules = {} as Record</* moduleName as */string, BaseModuleInterface>;

  private meetingInitQueue: Map<Client['id'], Client> = new Map();

  protected _model: Model;

  attendeeStorage: AttendeeStorage;
  connectionStorage: ConnectionStorage;

  protected leftAttendeesList: {
    attendee: Pick<
      Attendee,
      'id' |
      'room' |
      'role' |
      'firstName' |
      'lastName' |
      'email' |
      'externalAttID' |
      'osVersion' |
      'osName' |
      'browserVersion' |
      'browserName' |
      'joinedAt'
    >,
    time: number,
    attLength: number,
    durationInRun: number
  }[] = [];

  public eventBus = new EventEmitter();

  protected leftAttendeesTimer: NodeJS.Timer;
  protected serverTimeInterval: NodeJS.Timer;
  private _setupNoPresenterTimeout: NodeJS.Timer;
  private checkGSTimer: NodeJS.Timer;

  async setup() {
    this._model = new Model;
    this._model.meetingID = this.name;
    this._model.meetingRunID = uuid();

    this.attendeeStorage = new AttendeeStorage(this);
    this.connectionStorage = new ConnectionStorage(this);

    const sid = config.get<string>('systemUserAccountId');

    this.attendeeStorage.addAttendee({
      id: sid,
      userAccountID: sid,
      firstName: 'System Notification',
      lastName: '',
      role: Roles.GHOST,
      staticRole: Roles.SYSTEM,
      left: false,
    });

    await this._setModule('updateEngine', UpdateEngine);
    await this._setModule('batonEngine', BatonEngine);
    await this._setModule('roomEngine', RoomEngine);
    await this._setModule('layoutEngine', LayoutEngine);
    await this._setModule('assetsEngine', AssetsEngine);
    await this._setModule('adminEngine', AdminEngine);
    await this._setModule('exportingEngine', ExportingEngine);
    await this._setModule('statisticsEngine', StatisticsEngine);

    this.logger.info(`-=- SESSION HAS STARTED -=-`);

    // send server time to all session participants each 5 seconds (#453) delay disconnect notification
    // if the cable is unplugged, rooter crash or a some other network event is happened without net messaging
    this.serverTimeInterval = setInterval(() => this.sendServerTime(), 5000);

    this.initializeMeeting();

    return Promise.resolve();
  }

  get runId() {
    return this.model?.meetingRunID;
  }

  async beforeDestruct(code: ErrorCodes) {
    await super.beforeDestruct(code);

    this.server.sendMessage(AppInstanceMessagingEvents.BEFORE_SHUTDOWN, {});

    meetingRunGauge.remove(
      this._model.meetingID,
      this._model.meetingRunID,
      this._model.sessionSettings.name,
      this._model.sessionSettings.companyId
    );

    await Promise.all(
      Object.values(this._modules || {}).map(async (meetingModule) => {
        try {
          return await meetingModule.beforeDestruct(code);
        } catch (err) {
          apm.captureError(err);
          this.logger.error(`MeetingApplication got error when calling ${typeof meetingModule}.beforeDestruct. ${err.message}`);
          // noop we have no other means to deal with this error
        }
      })
    );
  }

  async destruct(code: ErrorCodes) {
    this.server.sendMessage(AppInstanceMessagingEvents.SHUTDOWN, {});

    if (this.serverTimeInterval) {
      clearInterval(this.serverTimeInterval);
      this.serverTimeInterval = null;
    }

    if (this.checkGSTimer) {
      clearTimeout(this.checkGSTimer);
      this.checkGSTimer = null;
    }

    Object.values(this.disconnectDelay || {}).forEach(timer => {
      clearTimeout(timer);
    });
    this.disconnectDelay = {};

    if (this.leftAttendeesTimer) {
      clearTimeout(this.leftAttendeesTimer);
      this.leftAttendeesTimer = null;
    }

    const attendees = this.attendeeStorage.getAttendees();
    for (const [_, attendee] of attendees) {
      if (attendee && !attendee.left) {
        this.sendLeftAttendeeInBuffer({attendee});
      }
    }

    this.emitAttendeesLeft();
    this.emitSessionClose();
    await Promise.all(
      Object.values(this._modules || {}).map(async (meetingModule) => {
        try {
          return await meetingModule.destruct(code);
        } catch (err) {
          apm.captureError(err);
          this.logger.error(`MeetingApplication got error when calling ${typeof meetingModule}.destruct. ${err.message}`);
          // noop we have no other means to deal with this error
        }
      })
    );

    if (this.lifeCycleState === ApplicationLifeCycleState.RUNNING) {
      coreApi.post<void>(
        RestAPI.SESSION_CLOSE,
        { /* body is empty */ },
        {
          params: {
            meetingID: this.model.meetingID
          }
        }
      );
    }

    this.logger.info('-=- SESSION HAS SHUTDOWN -=-');

    this.attendeeStorage.destruct();
    this.connectionStorage.destruct();

    this._model = null;
    this._modules = {};
    this.disconnectDelay = null;

    this.meetingInitQueue.clear();

    this.eventBus.removeAllListeners();

    return super.destruct(code);
  }

  get model(): Model { return this._model; }

  get updateEngine(): UpdateEngine { return (this._modules['updateEngine'] as UpdateEngine); }
  get batonEngine(): BatonEngine { return (this._modules['batonEngine'] as BatonEngine); }
  get roomEngine(): RoomEngine { return (this._modules['roomEngine'] as RoomEngine); }
  get exportingEngine(): ExportingEngine { return (this._modules['exportingEngine'] as ExportingEngine); }
  get layoutEngine(): LayoutEngine { return (this._modules['layoutEngine'] as LayoutEngine); }
  get adminEngine(): AdminEngine { return (this._modules['adminEngine'] as AdminEngine); }
  get assetsEngine(): AssetsEngine { return (this._modules['assetsEngine'] as AssetsEngine); }
  get statisticsEngine(): StatisticsEngine { return (this._modules['statisticsEngine'] as StatisticsEngine); }

  getModule(name: string): BaseModuleInterface {
    if (this._modules[name]) {
      return this._modules[name];
    }
    return null;
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  async onConnect(client: Client): Promise<void> {
    if (!client.data ||
      !client.data.aid || client.data.aid === 'undefined'
    ) {
      rejectConnection(this.server, client, this, ErrorCodes.AUTH_ERROR);

      const error = new Error('Rejecting connection for a client with no valid ID');
      apm.captureError(error, {
        custom: {
          invalidUserIp: client.ip,
          invalidUserData: JSON.stringify(client.data),
          mid: this._model.meetingID,
          mrunid: this._model.meetingRunID,
          name: this._model.sessionSettings.name,
        }
      });
      this.logger.error(`${error.message}. -= UNDEFINED CLIENT =- `, client.data);
      return;
    }

    if (this.lifeCycleState === ApplicationLifeCycleState.BROKEN) {
      rejectConnection(this.server, client, this, ErrorCodes.DOT_NET_CRITICAL, 'session is broken');
      return;
    }

    if (this.lifeCycleState !== ApplicationLifeCycleState.RUNNING) {
      this.meetingInitQueue.set(client.id, client);

      client.state = ClientState.WAITING_INIT;
      this.server.sendTo(ClientConnectionAPI.CONNECT, new ConnectionStatus(ConnectionStatus.WAITING, {}), client.id, true);

      this.logger.info('-= PUSH IN WAIT CLIENT =- ', client.data);
      return;
    }

    if (await this.connectAppClient(client)) {
      return;
    }

    if (!client.auth) {
      client.state = ClientState.WAITING_AUTH;
      this.server.sendTo(ClientConnectionAPI.CONNECT, new ConnectionStatus(ConnectionStatus.WAITING, {}), client.id, true);

      this.logger.info('-= WAITING FOR AUTHORIZATION =- ', client.data);
      return;
    }

    client.state = ClientState.PENDING;

    if (await this.connectInModeState(client)) {
      return;
    }

    this.connectInNormalState(client);
  }

  @Socket(ServerConnectionAPI.AUTH, '*')
  private async onAuth(@client client: Client) {
    if (this.lifeCycleState !== ApplicationLifeCycleState.RUNNING) {
      client.state = ClientState.PENDING;

      return;
    }

    if (await this.connectInModeState(client)) {
      return;
    }

    const attendee = this.model.attendeesIndex[client.data.aid];

    if (attendee && !attendee.left) {
      try {
        await this.rejoinAttendee(attendee, client);
      } catch (err) {
        this.server.disconnect(client.id, ErrorCodes.FORBIDDEN);
        throw err;
      }

      return;
    }

    this.connectInNormalState(client);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onDisconnect(client: Client) {
    this.meetingInitQueue.delete(client.id);
    this.connectionStorage.removeConnection(client.id);

    const attendee = this.model.attendeesIndex[client.data.aid];

    if (client.state === ClientState.REJECTED) {
      this.logger.debug(
        `Rejected client (${client.id}::${client.data.aid}) has been disconnected`,
        `${client.data.rejected.code} ${client.data.rejected.message}`
      );
      return;
    }

    if (this.lifeCycleState !== ApplicationLifeCycleState.RUNNING) {
      return;
    }

    if (client.data.mode === 'app') {
      void this.updateEngine.updateAttendee(null, client.data._aid, { app: '' });

      this.logger.debug(`app (${client.id}::${client.data._aid}) has been disconnected`);
      return;
    }

    if (!attendee) {
      this.logger.debug(`Unknown client (${client.id}) has been disconnected`);
      return;
    }

    if (client.data.duplicate) {
      this.logger.debug(`duplicate (${client.id}::${client.data.aid}) has been disconnected`);
      return;
    }

    // Prevent connected, but unauthenticated users from triggering any further events
    if (!client.auth) {
      return;
    }

    // @TODO check very careful this the hack here! can be used this.disconnectDelay instead
    // mark user
    attendee.left = true;

    if (attendee.role === Roles.GHOST) {
      this.setupRemoveAttendeeDelay(attendee.id);

      this.disconnectDelay[`msg${attendee.id}`] = setTimeout(
        () => this._setupGhostAttendeeDelay(client, attendee),
        serverConfig.CONFIG.socketServerConfig.userDisconnectDelay * 1000
      );
    } else if (attendee.kickedOut) {
      this.batonEngine.setupBaton(attendee.room);

      this.fiNewPresenter(attendee);
      this.sendLeftAttendeeInBuffer({attendee});

      this.eventBus.emit(AttendeeLeftAfterKickOut.type, attendee);
      this.notifyModulesRemoveAttendee(attendee.id);
      this.removeAttendee(attendee.id);

      this.logger.info(`-= CLIENT (${attendee.id}, ${attendee.role}) HAS BEEN KICKED OUT =-`, {
        clientsLength: this.server.clientsLength,
        kickedOut: attendee.kickedOut,
        clientId: client?.id,
        ip: client?.ip,
      });
    } else {
      // in this case phone remain like active user
      if (!attendee.phoneAudio) {
        this.setupRemoveAttendeeDelay(attendee.id);
      }

      const transaction = apm.currentTransaction;
      this.disconnectDelay[`msg${attendee.id}`] = setTimeout(
        () => {
          // @todo temporary add annomaly detector to see what is technology of the problem unknown sid
          if (!client.data) {
            const error = new Error('Client data is invalid in disconnect timer');

            apm.captureError(error, {
              custom: {
                clientData: JSON.stringify(client.data || {}),
                attendeeId: attendee.id,
                sessionId: this.model.meetingID,
                mrunid: this._model.meetingRunID,
                name: this._model.sessionSettings.name,
              }
            });
            this.logger.error(error.message, client.data);
          }

          const span = transaction?.startSpan('Meeting::_disconnectAttendee');
          this._disconnectAttendee(attendee, client);
          span?.end();
        },
        serverConfig.CONFIG.socketServerConfig.userDisconnectDelay * 1000
      );

      this.logger.info(
        `-= CLIENT (${attendee.id}) (${attendee.role}) PREPARE FOR DISCONNECTED =-`,
        { clientsLength: this.server.clientsLength }
      );
    }
  }

  onSocketBefore(client: Client, { method, data }: MessagePackage): boolean {
    if (!this.roomEngine.hasAnyPresenter) {
      switch (method) {
        case ServerConnectionAPI.AUTH:
        case ServerConnectionAPI.GET_ASSETS:
        case ServerConnectionAPI.POLL_INIT_DATA:
        case ServerConnectionAPI.INSTANT_POLL_INIT:
        case ServerConnectionAPI.TIMER_INIT:
        case ServerConnectionAPI.AVAILABLE_CAM_DEVICE:
        case ServerConnectionAPI.AVAILABLE_MIC_DEVICE:
        case ServerConnectionAPI.LOAD_LAYOUT:
        case ServerConnectionAPI.CHAT_LOAD_GROUP:
        case ServerConnectionAPI.LOAD_NOTES:
        case ServerConnectionAPI.CAMERA_STREAM_STATE:
        case ServerConnectionAPI.SET_ATT_MEDIA_CONN_STRENGTH:

        case ServerConnectionAPI.GET_PLAYING_ITEM:
        case ServerConnectionAPI.GET_ANNOTATION_MODE:
        case ServerConnectionAPI.GET_TRANSCRIBE_STATE:
        case ServerConnectionAPI.GET_SSR_STATE:
        // PLEASE KEEP IN SYNC WITH CLIENT APP
          return true;
        case ServerConnectionAPI.BOR_ADD_ATTENDEE:
          if (client.data.aid === data.id) {
            return true;
          }
        // tslint:disable-next-line:no-switch-case-fall-through
        case ServerConnectionAPI.WHITEBOARD_EVENT:
          if (data.action === WhiteboardAction.INIT) {
            return true;
          }
        // tslint:disable-next-line:no-switch-case-fall-through
        case ServerConnectionAPI.UPDATE:
          const attendee = this.model.attendeesIndex[data.id];
          if (attendee && (
            // @fixme - out of main room all is allowed !!!
            attendee.room !== '' ||

            data.data['browserName'] !== undefined ||
            data.data['browserVersion'] !== undefined ||
            data.data['osName'] !== undefined ||
            data.data['osVersion'] !== undefined ||
            data.data['isOutdatedBrowser'] !== undefined ||
            data.data['device'] !== undefined
          )) {
            return true;
          }
          break;
      }
      const a = this.model.attendeesIndex[client.data.aid];
      if (a && a.room !== '') {
        return true;
      }
      // NOTE: In case there was an Active Meeting Run, then a Socket Server restart,
      // the Presenter and all Attendees try to ReConnect, the attendeesIndex may not be containing a Presenter,
      // nor this Client yet, because it may take time for them to Authenticate.
      // This is kind of Race Condition, but it will be worth being more vigilant in covering it.
      this.logger.warn(
        `Restricted Client (${client.data.aid}) request to (${method}), because there is No Presenter`
      );
      this.server.disconnect(client.id, ErrorCodes.FORBIDDEN);

      return false;
    }
    return true;
  }

  @ApmSpan()
  private async initializeMeeting() {
    if (this.lifeCycleState === ApplicationLifeCycleState.RUNNING) {
      throw new Error('Meeting can be initialized only one time.');
    }

    const meetingDetails = {
      mid: this._model.meetingID,
      mrunid: this._model.meetingRunID
    };

    // keep the logger reference for later
    const logger = this.logger;
    try {
      // TODO: Make these load the data in parallel as requests to the Core API may be too slow and flacky,
      // but ensure synchronization over the side effects is proper, so first Settings side effects are applied and then Rooms
      await this.adminEngine.loadMeetingSettings();
      await this.roomEngine.loadRooms();

      if (this.isClosed()) {
        throw new Error('Load session settings and room register received too late, the Session is not Running anymore!');
      }

      await this.roomEngine.normalizeRooms();

      if (this.isClosed()) {
        throw new Error('Load session state completed too late, the Session is not Running anymore!');
      }

      this.logger.info(`-=- SESSION HAS INITIALIZED -=-`);

      this.lifeCycleState = ApplicationLifeCycleState.RUNNING;

      await Promise.all(
        Object.keys(modules).map(id => this._setModule(id, modules[id]))
      );

      meetingRunGauge.set({
        ...meetingDetails,
        name: this._model.sessionSettings.name,
        company_id: this._model.sessionSettings.companyId
      }, 1);

      this.eventBus.emit(SessionInitEvent.type);
      this._model.initialzedAt = Date.now();
    } catch (err) {
      this.lifeCycleState = ApplicationLifeCycleState.BROKEN;

      const custom: any = {
        ...meetingDetails,
        method: `Meeting.initializeMeeting`
      };

      if (this._model?.sessionSettings) {
        custom.name = this._model.sessionSettings.name;
        custom.company_id = this._model.sessionSettings.companyId;
      }

      apm.captureError(err, { custom });
      logger.error(err.message, custom);
    }

    for (const [id, client] of this.meetingInitQueue) {
      if (this.lifeCycleState === ApplicationLifeCycleState.BROKEN) {
        rejectConnection(this.server, client, this, ErrorCodes.DOT_NET_CRITICAL, 'session init has failed');
      } else {
        this.onConnect(client);
      }
    }

    this.meetingInitQueue.clear();
  }

  protected sendServerTime(cid?: Client['id']) {
    this.server.sendTo(ClientConnectionAPI.SERVER_TIME, { ts: (new Date()).getTime() }, cid);
  }

  private notifyModulesRemoveAttendee(aid: string) {
    Object.values(this._modules || {}).forEach(meetingModule => {
      try {
        meetingModule.onRemoveAttendee(aid);
      } catch (err) {
        apm.captureError(err);
        this.logger.error(`MeetingApplication got error when calling ${typeof meetingModule}.onRemoveAttendee. ${err.message}`);
      }
    });
  }

  setupRemoveAttendeeDelay(aid: Attendee['id']) {
    const attendee = this.attendeeStorage.getAttendeeById(aid);

    if (attendee) {
      this.clearRemoveAttendeeDelay(aid);

      const transaction = apm.currentTransaction;
      this.disconnectDelay[`rem${aid}`] = setTimeout(
        () => {
          const span = transaction?.startSpan('Meeting::_removeIdleAttendee');
          this._removeIdleAttendee(attendee);
          span?.end();
        },
        serverConfig.CONFIG.socketServerConfig.userIdleDelay * 1000
      );
    }
  }

  private async _disconnectAttendee(attendee: Attendee, client: Client) {
    await this.updateEngine.updateAttendee(null, attendee.id, { left: true });
    this.batonEngine.setupBaton(attendee.room);

    if (!this.roomEngine.hasActiveMainRoomPresenter()) {
      const candidate = this.roomEngine.getCohostCandidate();
      if (candidate) {
        await this.updateEngine.updateAttendee(null, candidate.id, { role: Roles.COHOST });
      }
    }

    this.fiNewPresenter(attendee);

    this.sendLeftAttendeeInBuffer({ attendee });

    if (attendee.app) {
      this.server.disconnect(attendee.app, ErrorCodes.KILL);
    }

    this.logger.info(`-= CLIENT (${attendee.id}), ${attendee.role} HAS BEEN DISCONNECTED =-`, {
      clientsLength: this.server.clientsLength,
      clientId: client?.id,
      ip: client?.ip,
    });
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private async _setupGhostAttendeeDelay(client: Client, a: Attendee) {
    await this.updateEngine.updateAttendee(client, a.id, { left: true });

    this.logger.info(`-= GHOST ${a.staticRole}(${a.id}) HAS BEEN DISCONNECTED =-`, {
      clientsLength: this.server.clientsLength,
      clientId: client.id,
      ip: client.ip
    });
  }

  private _removeIdleAttendee(a: Attendee) {
    this.eventBus.emit(AttendeeLeftAfterTimeoutEvent.type, a);
    this.notifyModulesRemoveAttendee(a.id);
    this.removeAttendee(a.id);

    this.logger.info(`-= CLIENT (${a.id}) (${a.role}) HAS BEEN REMOVED =-`, { clientsLength: this.server.clientsLength });
  }

  clearRemoveAttendeeDelay(id) {
    clearTimeout(this.disconnectDelay[`rem${id}`]);
  }

  clearDisconnectAttendeeDelay(id) {
    clearTimeout(this.disconnectDelay[`msg${id}`]);
  }

  @ApmSpan()
  private async connectInNormalState(client: Client) {
    this.clearRemoveAttendeeDelay(client.data.aid);
    this.clearDisconnectAttendeeDelay(client.data.aid);

    const logger = this.logger;
    const a: Attendee = this.model.attendeesIndex[client.data.aid];

    if (!a) { // validate only in user is not in the list
      // keep a reference to this logger as the code below can be called any time later even after destruct
      logger.debug(`Session already initialized, authorizing using "auth" request for client aid: ${client.data.aid}`);

      try {
        await this.joinAttendee(client);
      } catch (err) {
        this.joinMeetingErrorTracking(client, err, logger);
      }
    } else if (a.kickedOut) {
      // doesn't need from additional call if the attendee is banned
      rejectConnection(this.server, client, this, ErrorCodes.JOIN_WITH_KICKOUT, a.kickedOut);
    } else {
      await this.rejoinAttendee(a, client);
    }
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.AUTH })
  private async joinAttendee(client: Client) {
    try {
      await coreApi.post<void>(RestAPI.AUTHORIZATION, {
        meetingId: this.model.meetingID,
        userAccountId: client.auth.impersonated_id || client.auth.sub,
        meetingAttendeeId: client.data.aid
      });

      const data = await this.fetchAttendeeInfo(client.data.aid);

      if (this.isClosed()) {
        const logMsg = 'CoreAPI Response received too late, the Session is not Running anymore!';
        const logMeta = {
          method: `Meeting.joinAttendee`,
          meetingId: this.model.meetingID,
          userAccountId: client.auth.impersonated_id || client.auth.sub
        };
        apm.captureError(logMsg, { custom: { ...logMeta } });
        this.logger.warn(logMsg, logMeta);
        // do nothing more
        return;
      }

      await this.setupNewUser(data, client);
      this.sendServerTime(client.id);
    } catch (err) {
      this.joinMeetingErrorTracking(client, err, this.logger);
      return;
    }
  }

  async fetchAttendeeInfo(meetingAttendeeId: Attendee['id']): Promise<AttendeeAuthResponse> {
    const { data } = await coreApi.put<AttendeeAuthResponse>(RestAPI.ATTENDEE_JOIN_INFO, {
      meetingAttendeeId
    });

    return data;
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.AUTH })
  private async rejoinAttendee(attendee: Attendee, client: Client) {
    try {
      const clientData = {
        meetingId: this.model.meetingID,
        userAccountId: client.auth.impersonated_id || client.auth.sub,
        meetingAttendeeId: client.data.aid
      };
      await coreApi.post<void>(
        RestAPI.AUTHORIZATION,
        clientData
      );

      if (this.isClosed()) {
        const logMsg = 'CoreAPI Response received too late, the Session is not Running anymore!';
        const logMeta = {
          method: `Meeting.rejoinAttendee`,
          ...clientData
        };
        apm.captureError(logMsg, { custom: { ...logMeta } });
        this.logger.warn(logMsg, logMeta);
        // do nothing more
        return;

      }

    } catch (err) {
      // if there has a connection try but the attendee with this aid is still online in session
      if (!attendee.left) {
        client.data.aid = null;
      }

      this.joinMeetingErrorTracking(client, err, this.logger);
      return;
    }

    const updatePack = {
      joinedAt: Date.now(),
      ...this.getBrowserAndOSInfo(client)
    };

    /// ---------------

    let hasDuplication = false;

    if (!client.data.force) {
      const conn = this.connectionStorage.getAttendeeConnection(attendee.id);

      if (conn?.data.runid === client.data.runid) {
        conn.data.duplicate = hasDuplication = true;
      }
    }

     /// ---------------

    if (attendee.left || hasDuplication || attendee.role === Roles.PHONE) {
      this.connectionStorage.addUpdateConnection(attendee.id, client.id);

      const index = this.leftAttendeesList.findIndex(pack => pack.attendee.id === client.data.aid);
      if (index > -1) {
        this.leftAttendeesList.splice(index, 1);
      }

      await this.updateEngine.updateAttendee(null, attendee.id, Object.assign(updatePack, {
        left: false,
        role: attendee.role === Roles.PHONE ? attendee.staticRole : attendee.role
      }));

      client.state = ClientState.ACTIVE;

      this.server.sendTo(ClientConnectionAPI.CONNECT, new ConnectionStatus(ConnectionStatus.ACCEPT, this.getModelForAttendee(attendee.id)), client.id);
      this.sendServerTime(client.id);

      this.eventBus.emit(AttendeeJoinSuccessEvent.type, attendee, true, client);

      this.updateMaxAttendeesInRun();

      this.ifNewPresenter(client, attendee);

      this.logger.info(`-= CLIENT (${attendee.id}, ${attendee.role}) HAS BEEN CONNECTED =-`, {
        clientsLength: this.server.clientsLength,
        clientId: client.id,
        ip: client.ip
      });
      this.batonEngine.setupBaton(attendee.room);
    } else if (client.data.force) {
      const currClient = this.connectionStorage.getAttendeeConnection(attendee.id);

      if (currClient) {
        currClient.data.duplicate = true;

        this.server.disconnect(currClient.id, ErrorCodes.KICK_FROM_SECOND);
      }

      this.connectionStorage.addUpdateConnection(attendee.id, client.id);

      const test: any = Roles.PHONE; // fix ts bug - https://github.com/Microsoft/TypeScript/issues/25642
      if (attendee.role === test) {
        Object.assign(updatePack, { role: attendee.staticRole });
      }

      // TODO: this should be in audio and video module
      // we need this so the cam and mic to be closed before the new browser connects - #446
      await this.updateEngine.updateAttendee(client, attendee.id, Object.assign(updatePack, {
        hasCam: false,
        hasMic: false,
      }));

      client.state = ClientState.ACTIVE;

      // no one other will know for this change
      this.server.sendTo(ClientConnectionAPI.CONNECT, new ConnectionStatus(ConnectionStatus.ACCEPT, this.getModelForAttendee(attendee.id)), client.id);
      this.sendServerTime(client.id);

      this.eventBus.emit(AttendeeJoinSuccessEvent.type, attendee, true, client);

      this.updateMaxAttendeesInRun();

      this.ifNewPresenter(client, attendee);

      this.logger.info(`-= CLIENT (${attendee.id}) HAS BEEN FORCE CONNECTED =-`, { clientsLength: this.server.clientsLength });
    } else {
      client.data.duplicate = true;

      this.server.disconnect(client.id, ErrorCodes.DOUBLE_JOIN);

      this.logger.info(`-= CLIENT (${client.data.aid}) IS TRYING TO CONNECT AGAIN =-`);
    }
  }

  private joinMeetingErrorTracking(client: Client, error: AxiosError, logger: Logger) {
    // see https://kapeli.com/cheat_sheets/Axios.docset/Contents/Resources/Documents/index#//dash_ref/Category/Handling%20Errors/1
    switch (error.response?.status) {
      case ErrorCodes.MISSING_HOST:
        logger.info(`Missing Host Auth Response ${error.response.status}[${error.response.statusText}] (${error.request.url})`, {
          client: client.data,
          stack: error
        });
        rejectConnection(this.server, client, this, ErrorCodes.MISSING_HOST, 'Missing Host, please try again later');
        break;
      case ErrorCodes.SESSION_NOT_STARTED:
        logger.info(`Session Not Started Auth Response ${error.response.status}[${error.response.statusText}]`, {
          client: client.data,
          stack: error
        });
        rejectConnection(this.server, client, this, ErrorCodes.SESSION_NOT_STARTED, error.response?.data?.message || 'Session not started, please join later');
        break;
      case ErrorCodes.BAD_CREDENTIAL:
        apm.captureError(error, {
          custom: { clientData: JSON.stringify(client.data) }
        });
        logger.error(`Bad Credentials Auth Response ${error.response.status}[${error.response.statusText}]`, {
          client: client.data,
          stack: error
        });
        rejectConnection(this.server, client, this, ErrorCodes.BAD_CREDENTIAL, 'Bad credentials, please try again');
        break;
      default:
        apm.captureError(error, {
          custom: { clientData: JSON.stringify(client.data) }
        });
        logger.error(`Auth request has failed with error. ${error.message} ${error.stack}`);
        rejectConnection(this.server, client, this, ErrorCodes.DOT_NET_CRITICAL);
        break;
    }
  }

  protected async connectAppClient(client: Client): Promise<boolean> {
    if (client.data.mode === 'app') {
      const attendee = this.model.attendeesIndex[client.data.aid];
      const curClient = this.server.clients.get(client.id);

      client.data._aid = client.data.aid;
      delete client.data.aid;

      client.state = ClientState.ACTIVE;

      if (attendee && curClient) {
        await this.updateEngine.updateAttendee(null, client.data._aid, { app: client.id });

        this.logger.info(`-= APP (${client.id}::${client.data._aid}) HAS BEEN CONNECTED =-`);
      } else {
        rejectConnection(this.server, client, this, ErrorCodes.AUTH_ERROR);

        this.logger.info(`-= APP (${client.id}::${client.data._aid}) HAS BEEN REJECTED =-`);
      }

      return true;
    }

    return false;
  }

  @ApmSpan()
  protected async connectInModeState(client: Client): Promise<boolean> {
    if (client.data.mode) {

      client.data.rid = (client.data.rid || '');

      // @FIX - if no one real is available then this system (ghost) is invalid
      const ghost = new Attendee({
        room: client.data.rid,
        role: Roles.GHOST,
        left: false,
        timezoneOffset: this.model.sessionSettings.timezoneOffset
      });
      client.data.aid = `${client.id}-${this.model.sessionSettings.hostID}`;

      switch (client.data.mode) {
        case 'mixer': {
          ghost.staticRole = Roles.MIXER;
          client.data.aid = `mixer-user-${client.data.rid ? client.data.rid : this.model.meetingID}`;
          break;
        }
        case 'admin': {
          ghost.staticRole = Roles.ADMIN;
          break;
        }
        case 'ssr': {
          ghost.staticRole = Roles.RECORDER;
          client.data.aid = `ssr-user-${client.id}-${client.data.rid ? client.data.rid : this.model.meetingID}`;
          break;
        }
        case 'transcribe': {
          ghost.staticRole = Roles.TRANSCRIBE;
          client.data.aid = `transcribe-user-${client.id}-${client.data.rid ? client.data.rid : this.model.meetingID}`;
          break;
        }
      }

      this.clearRemoveAttendeeDelay(client.data.aid);
      this.clearDisconnectAttendeeDelay(client.data.aid);

      await this.setupNewUser(ghost, client);

      return true;
    }

    return false;
  }

  private async _setModule(name, cls: BaseModuleInterfaceStatic) {
    if (!cls.isEnabled(this)) {
      return;
    }

    this.logger.debug(`Add module ${name} to the session ${this.type}.${this.name}`);
    const span = apm.startSpan(`${name}.setup`);
    const setupRes = await (this._modules[name] = new cls(this)).setup();
    span?.end();

    return setupRes;
  }

  removeAttendee(aid: Attendee['id']) {
    this.clearRemoveAttendeeDelay(aid);

    this.attendeeStorage.removeAttendee(aid);

    this.server.sendTo(ClientConnectionAPI.REMOVE, aid);

    if (!this.roomEngine.getAnyPresenter()) {
      this.roomEngine.emptyAllRooms();
    }
  }

  @ApmSpan()
  async setupNewUser(
    attendeeData: AttendeeAuthResponse | Attendee | Partial<AttendeeBase>,
    client: Client = null
  ) {
    if (client) {
      if (!attendeeData || (attendeeData.role !== Roles.GHOST && attendeeData.id !== client.data.aid)) {
        return rejectConnection(this.server, client, this, ErrorCodes.AUTH_ERROR);
      }

      const { kickoutTimestamp: timestamp, kickoutReason: reason } = attendeeData as AttendeeAuthResponse;

      if (timestamp) {
        const ctime = (new Date).getTime();

        if (ctime < timestamp) {
          return rejectConnection(this.server, client, this, ErrorCodes.GOT_KICKOUT, reason);
        }
      }

      Object.assign(attendeeData, this.getBrowserAndOSInfo(client), {id: client.data.aid});
    }

    const a = this.attendeeStorage.addAttendee(
      Object.assign(attendeeData, {joinedAt: Date.now()})
    );

    if (client) {
      this.connectionStorage.addUpdateConnection(a.id, client.id);
    }

    Object.values(this._modules || {}).forEach(meetingModule => {
      try {
        meetingModule.onAddAttendee(a);
      } catch (err) {
        apm.captureError(err);
        this.logger.error(`MeetingApplication got error when calling ${typeof meetingModule}.onAddAttendee. ${err.message}`);
      }
    });

    await this.updateEngine.approveAndApplyData(client, { id: a.id, data: { left: false, attendeeAdded: true } });

    const attendees = this.attendeeStorage.getAttendees()

    for (const [aid, attendee] of attendees) {
      const cid = this.connectionStorage.getClientId(aid);

      if (!cid) {
        continue;
      }

      if (a.id === aid) {
        this.connectionStorage.getAttendeeConnection(aid).state = ClientState.ACTIVE;
        this.server.sendTo(
          ClientConnectionAPI.CONNECT,
          new ConnectionStatus(ConnectionStatus.ACCEPT, this.getModelForAttendee(a.id)),
          client.id
        );
        continue;
      } else {
        this.server.sendTo(ClientConnectionAPI.JOIN, this.model.attendeesIndex[a.id], cid);
      }
    }

    if (a.role === Roles.GHOST) {
      this.logger.info(`-= CLIENT (${a.staticRole}) HAS BEEN CONNECTED =-`, {
        clientsLength: this.server.clientsLength,
        clientIp: client?.ip,
        id: client?.id
      });
    } else {
      this.ifNewPresenter(client, a);

      this.logger.info(`-= CLIENT (${a.id}, ${a.role}) HAS BEEN CONNECTED =-`, {
        clientsLength: this.server.clientsLength,
        clientIp: client?.ip,
        id: client?.id,
      });
      this.batonEngine.setupBaton('');
    }

    this.eventBus.emit(AttendeeFirstJoinSuccessEvent.type, a, client);
    this.eventBus.emit(AttendeeJoinSuccessEvent.type, a, false, client);
    this.updateMaxAttendeesInRun();
  }

  ifNewPresenter(client: Client, a: Attendee) {
    if (a.staticRole === Roles.HOST || a.staticRole === Roles.COHOST || a.staticRole === Roles.PRESENTER || a.role === Roles.COHOST) {
      // if this that join is presenter or host, or co-host including promoted in the session
      this.clearNoPresenterTimeout();

      if (!this.roomEngine.hasAnyPresenter) {
        this.sendNoPresenterMessage(false)
      }
    } else {
      if (!this.roomEngine.hasAnyPresenter) {
        // @TODO - this is not good logic - for sure have to be revise
        setTimeout(() => {
          if (this.roomEngine.hasAnyPresenter) {
            return;
          }
            if (client) {
              this.server.sendTo(ClientConnectionAPI.HAS_ANY_PRESENTER, false, client.id);
            }
          }, 2000);

        const online = Object.values(this.model.attendeesIndex).filter(att => {
          return !att.left && att.role !== Roles.GHOST;
        });

        // first join reset the timer
        if (online.length === 1) {
          this.setupNoPresenterTimeout();
        }
      }
    }
  }

  fiNewPresenter(attendee: Attendee) {
    // should check for Co-Host promoted in the session
    if (!attendee || attendee.staticRole === Roles.HOST ||
      attendee.staticRole === Roles.COHOST ||
      attendee.staticRole === Roles.PRESENTER ||
      attendee.role === Roles.COHOST) {
      const hasAnyPresenter = this.roomEngine.hasAnyPresenter;
      const checkForPresenter = this.roomEngine.getAnyOnlinePresenter();
      if (!checkForPresenter && hasAnyPresenter) {
        this.sendNoPresenterMessage(true);
        this.setupNoPresenterTimeout();
      }
    }
  }

  setupNoPresenterTimeout() {
    clearTimeout(this._setupNoPresenterTimeout);
    this._setupNoPresenterTimeout = setTimeout(() => {
      if (!this.server) {
        return;
      }

      this.eventBus.emit(NoMainPresenterTimeoutEvent.type, 'No Presenter Timeout');

      for (const [_, client] of this.server.clients) {
        this.server.disconnect(client.id, ErrorCodes.NO_PRESENTER_TIMEOUT, 'No Presenter Timeout');
      }
    }, serverConfig.CONFIG.socketServerConfig.waitPresenterTimeout * 1000);
  }

  clearNoPresenterTimeout() {
    clearTimeout(this._setupNoPresenterTimeout);
  }

  getModelForAttendee(aid: Attendee['id']): Model {
    const client = this.connectionStorage.getAttendeeConnection(aid);

    return {
      ...this.model,
      attendeeID: aid,
      attendeeIP: client ? client.ip : '',
      attendee: undefined
    };
  }


  protected sendLeftAttendeeInBuffer({attendee}: Pick<Meeting['leftAttendeesList'][0], 'attendee'>) {
    if (attendee.role === Roles.GHOST) {
      return;
    }

    if (!this.leftAttendeesTimer) {
      this.leftAttendeesTimer = setTimeout(() => this.emitAttendeesLeft(), 4000);
    }
    const now = Date.now();
    this.leftAttendeesList.push({
      // make a snapshot of the Attendee's data as
      // it may be cleared before the left events can are sent
      attendee: {
        id: attendee.id,
        room: attendee.room,
        role: attendee.role,
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        email: attendee.email,
        externalAttID: attendee.externalAttID,
        joinedAt: attendee.joinedAt,
        osVersion: attendee.osVersion,
        osName: attendee.osName,
        browserVersion: attendee.browserVersion,
        browserName: attendee.browserName
      },
      time: now,
      attLength: this.getAllAttendeeIds((aid) => {
        const a = this.model.attendeesIndex[aid];
        return (a && a.role !== Roles.GHOST && !a.left);
      }).length,
      durationInRun: attendee.joinedAt == null ? 0 : (now - attendee.joinedAt) / 1000
    });
  }

  private emitAttendeesLeft() {
    const leftAttendeesList = this.leftAttendeesList;

    this.leftAttendeesList = [];
    this.leftAttendeesTimer = null;

    if (leftAttendeesList.length) {
      coreApi.post<void>(
        RestAPI.SESSION_LEAVE,
        {
          attendees: leftAttendeesList.map(
            ({
              attendee,
              time,
              attLength
            }) => ({
              aid: attendee.id,
              room: attendee.room,
              role: attendee.role,
              time,
              attLength
            })
          ),
          meetingRunID: this.model.meetingRunID
        },
        {
          params: {
            meetingID: this.model.meetingID
          }
        }
      );

      for (const leftAttendee of leftAttendeesList) {
        this.eventBus.emit(AttendeeLeftEvent.type, leftAttendee);
      }
    }
  }

  private emitSessionClose() {
    let sessionRunDuration = Date.now() - this._model.initialzedAt;
    sessionRunDuration = sessionRunDuration / 1000; // in seconds!
    this.eventBus.emit(SessionCloseEvent.type, {
      sessionRunDuration: sessionRunDuration,
      maxAttendeesInRun: this._model.maxAttendeesInRun
    });
  }

  private updateMaxAttendeesInRun() {
    const attLength = this.getAllAttendeeIds((aid) => {
      const a = this.model.attendeesIndex[aid];
      return (a && a.role !== Roles.GHOST && !a.left);
    }).length;
    if (this.model.maxAttendeesInRun < attLength) {
      this.model.maxAttendeesInRun = attLength;
    }

    this.logger.debug(`MaxAttendeesInRun: {this.model.maxAttendeesInRun}`);
  }

  private getBrowserAndOSInfo(client: Client) {
    let browserAndOSInfo = {};
    if (client) {
      const userAgentParsed = client.userAgentInfo;
      if (userAgentParsed != null) {
        browserAndOSInfo = {
          osVersion: userAgentParsed.os.versionName || '',
          osName: userAgentParsed.os.name,
          browserVersion: `${parseFloat(userAgentParsed.browser.version)}`,
          browserName: userAgentParsed.browser.name
        };
      }
    }
    return browserAndOSInfo;
  }

  private sendNoPresenterMessage(noPresenter: boolean) {
    this.server.sendTo(ClientConnectionAPI.HAS_ANY_PRESENTER, !noPresenter);
    this.eventBus.emit(NoMainPresenterEvent.type, noPresenter);
  }

  // TOOLS

  @ApmSpan()
  sendToAttendee(aid: Attendee['id'], method: string, data: any = '') {
    const attendee = this.attendeeStorage.getAttendeeById(aid);

    if (!attendee || attendee.left) {
      return;
    }

    const cid = this.connectionStorage.getClientId(aid);

    if (cid) {
      this.server.sendTo(method, data, cid);
    }
  }

  @ApmSpan()
  sendToAttendees(aids: Set<Attendee['id']> | Attendee['id'][], method: string, data: any = '') {
    const cIds = [];

    for (const aid of aids) {
      const attendee = this.attendeeStorage.getAttendeeById(aid);

      if (!attendee || attendee.left) {
        continue;
      }

      const cid = this.connectionStorage.getClientId(aid);

      if (cid) {
        cIds.push(cid);
      }
    }

    this.server.sendTo(method, data, cIds);
  }

  getAllAttendeeIds(filter?: (aid: Attendee['id'], attendee: Attendee) => boolean | undefined): string[] {
    if (!filter) {
      filter = (_, attendee) => !!attendee;
    }
    const aids = [];
    const attendees = this.attendeeStorage.getAttendees();

    for (const [aid, attendee] of attendees) {
      if (!filter(aid, attendee)) {
        continue;
      }

      aids.push(attendee.id);
    }

    return aids;
  }
}
