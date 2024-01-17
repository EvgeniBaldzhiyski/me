import apm from 'elastic-apm-node/start';
import config from 'config';
import { TokenSet } from 'openid-client';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import BaseModule from '../BaseModule';
import Meeting from '../../Meeting';
import serverConfig from '../../../../utils/serverConfig';
import Client from '../../../../utils/Client';
import {
  Attendee, ClientConnectionAPI,
  MicState,
  Roles,
  Room,
  ServerConnectionAPI,
  ServerRestAPI,
  SessionAudio,
  RestAPI,
  SsrItemStatus,
  AttendeeBase,
  ErrorCodes
} from '@container/models';
import { NoMainPresenterEvent, NoMainPresenterTimeoutEvent, SessionEventTypes, SessionInitEvent } from '../../events/SessionEvents';
import { MixerBoxJob, MixerController } from './MixerController';
import { TaskMessage, TaskStatus } from '../../../../tasks/task-resources';
import { mixerFactoryPromise } from '../../../../tasks/worker-factory';
import { coreApi } from '../../../../utils/coreApiClient';
import { AxiosError } from 'axios';
import { JwtSubjects } from '../../../../gateway/types';
import { Get, Post } from '../../../../gateway/decorators/method.decorator';
import { getGhostUserAuth } from '../../../../utils/get-ghost-user-auth';

class MixerItem {
  public worker: MixerController;

  private startTimeout;
  private _status: SsrItemStatus = SsrItemStatus.STOPPED;

  onDone: (item: MixerItem) => void = () => { };
  onStartOut: (item: MixerItem) => void = () => { };

  constructor(
    private _id: string,
    private inst: Meeting
  ) { }

  get id() {
    return this._id;
  }
  get status(): SsrItemStatus {
    return this._status;
  }
  set status(value: SsrItemStatus) {
    this._status = value;

    clearTimeout(this.startTimeout);

    if (this._status === SsrItemStatus.INIT) {
      const timeout = this.normalizeTimer(config.get('mixer.startTimeout'));

      clearTimeout(this.startTimeout);
      this.startTimeout = setTimeout(() => this.onStartOut(this), timeout);
    } else if (this._status === SsrItemStatus.PUBLISHED) {

    } else if (this._status === SsrItemStatus.STOPPED) {
      this.onDone(this);
    }
  }
  clear() {
    clearTimeout(this.startTimeout);
  }

  private normalizeTimer(def: number): number {
    return (def * 1000);
  }
}

class SpeakBuffer {
  /**
   * @param _stat {number} represent the speaker's state
   *  - ( 1) speak on
   *  - ( 0) no action
   *  - (-1) speak off
   */
  private _stat: 1 | 0 | -1 = 0;

  private timer: NodeJS.Timeout;
  private timeout = 1.5; // in secs

  constructor(doneCallback: Function) {
    this.timer = setTimeout(() => doneCallback(), (this.timeout * 1000));
  }
  get status() {
    return this._stat;
  }
  change(newState: boolean) {
    if ((newState && this._stat < 1) || (!newState && this._stat > -1)) {
      this._stat += (newState ? 1 : -1);
    }
  }
  destruct() {
    clearTimeout(this.timer);
  }
}

interface Tail {
  id: Attendee['id'];
  action: 'new' | 'change';
  join: boolean;
  data: Partial<AttendeeBase>;
}

type TailMap = Map<Attendee['id'], Tail>;

/**
 * @deprecated
 */
export default class PhoneModule extends BaseModule {
  private tails: Record<Room['id'], TailMap> = {};
  private mixers: Record<Room['id'], MixerItem> = {};
  private nextTryRegister: Record<Room['id'], NodeJS.Timeout> = {};
  private nextTryTime = 10000;

  private phones = 0;
  private phantoms = {};

  private speakBuffer: Record<Attendee['id'], SpeakBuffer> = {};

  static isEnabled(inst: Meeting) {
    return false;
  }

  private _onChangeStatus = (data: TaskMessage) => {
    this.changeStatus(data);
  }

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);

    this.inst.server.onSocket(ServerConnectionAPI.PHONE_DIAL_OUT, (client, data) => this.onPhoneDiedOut(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.PHONE_CALL_ME, (client, data) => this.callMe(client, data));

    this.inst.eventBus.on(NoMainPresenterTimeoutEvent.type, (value) => this.onPresenterAvailableTimeout(value));
    this.inst.eventBus.on(NoMainPresenterEvent.type, (value) => this.onPresenterAvailable(value));
    this.inst.eventBus.on(SessionEventTypes.REFRESH_SETTINGS, () => this.onRefreshSettings());

    // @warning if phone leaves during restart may have a problem
    this.inst.eventBus.on(SessionInitEvent.type, _ => {
      for (const attendee of Object.values(this.inst.model.attendeesIndex)) {
        if (attendee?.phoneAudio) {
          this.startMixer(attendee?.room);
        }
      }
    });
  }

  /**
   * @tool Simulate connection drop in both directions
   *
   * @link https://sock.local.interactive.com/meeting/<MID>/refresh-mixer-client[?server=1]
   */
  @Get(ServerRestAPI.REFRESH_MIXER_CLIENT) // @SUT
  private onRefreshMixerClient (params) {
    if (!serverConfig.CONFIG.sut.enabled) {
      return;
    }

    const item = this.mixers[params.room || ''];

    if (item && item.status === SsrItemStatus.PUBLISHED) {
      const ghosts = this.inst.attendeeStorage.getAttendeesByRole(Roles.GHOST);

      for (const [, ghost] of ghosts) {
        if (ghost.staticRole === Roles.MIXER && ghost.room === item.id && !ghost.left) {
          const cid = this.inst.connectionStorage.getClientId(ghost.id);

          if (cid) {
            if (params.server) {
              this.inst.server.disconnect(cid);
            } else {
              this.inst.server.sendTo(ClientConnectionAPI.REFRESH_CONNECTION, undefined, cid);
            }
          }
          return;
        }
      }
    }
  }

  @ApmSpan()
  async approveAttendeeChange(client, id, data, done) {
    const a: Attendee = this.inst.model.attendeesIndex[id];

    let s: Attendee;
    if (client) {
      s = this.inst.model.attendeesIndex[client.data.aid];
    }

    const roomid: string = a.room;

    if (data.left !== undefined) {
      if (a.phoneAudio) {
        if (data.left &&
          data.phoneAudio === undefined // if it is not forced from onPhoneCall
        ) {
          data.left = false;
          data.role = Roles.PHONE;

          if (a.isAway) {
            data.isAway = false;
          }
        }
      }

      if (a.staticRole === Roles.MIXER) {
        // TODO: This was added as an optimization, when phone audio is set to 'Keep audio in phone',
        //       but it prevents SSR from capturing audio we should instead enable mixer audio when
        //       SSR joins, but currently there are other checks that prevent this. We should revise
        //       these and refine them

        // if (this.inst.model.sessionSettings.audio[2] &&
        //   this.inst.model.sessionSettings.audio[0] === SessionAudio.PHONE_ONLY
        // ) {
        //   data.micMuted = true;
        //   data.micState = MicState.normal;
        // }
        const item = this.mixers[roomid];
        if (item && item.status === SsrItemStatus.PUBLISHED) {
          if (data.left) {
            const error = new Error(`Mixer (${item.id}) has been disconnected in publish time!`);
            this.inst.logger.error(error.message, {aid: data.id});
          } else {
            this.inst.logger.info(`Mixer (${item.id}) has re-connected in publish time!`, {aid: data.id});
          }
        }
      }
    }
    if (data.room !== undefined) {
      if (a.staticRole === Roles.MIXER) {
        return done(null);
      }
      if (a.phoneAudio || this.tails[a.room]?.has(id)) {
        this.move(roomid, data.room, id, false);

        if (data.room === '' && !this.inst.roomEngine.hasAnyPresenter) {
          this.waitForPresenter('', id, true, 'Please wait for the presenter to join the session.');
        }
      }
    }

    if (!s || s.hasBaton) {
      if (data.kickedOut !== undefined) {
        if (a.phoneAudio) {
          data.phoneAudio = '';

          this.kickout(roomid, id, 'You have been kicked out of this session.' + data.kickedOut);

          if (a.role === Roles.PHONE) {
            data.left = true;
          }
        }
      }

      if (data.micState !== undefined) {
        // the change is allowed only in init process
        if (a.staticRole === Roles.MIXER && !data.attendeeAdded) {
          return done(null);
        }
      }
    }

    if (this.inst.model.sessionSettings.audio[0] === SessionAudio.PHONE_ONLY && data.micState === MicState.missing) {
      const room = this.inst.model.roomsIndex[roomid];

      if (room?.enabledAllMic) {
        data.micState = MicState.denied;
      } else {
        data.micState = MicState.normal;
      }

      data.hasMic = true;
    }

    const lastState = a.micState;

    await done(data);

    // @todo do it only if there does not have phoneAudio (in case mic state is just changed)
    if (data.phoneAudio === undefined && data.room === undefined && data.attendeeAdded === undefined) {
      if (a.phoneAudio && a.micState !== lastState) {
        if (a.micState === MicState.denied) {
          this.mute(a.room, a.id, true);
        }

        if (lastState === MicState.denied) {
          this.onPhoneSpeaking(a.id, true);
          this.mute(a.room, a.id, false);
        }
      }
    }

    if (a && a.role === Roles.PHONE) {
      if (a.left) {
        this.inst.setupRemoveAttendeeDelay(a.id);
      } else {
        this.inst.clearRemoveAttendeeDelay(a.id);
      }
    }

    if (data.left || data.phoneAudio === '') {
      this.checkMixerStatus(a.room);
    }
  }

  async beforeDestruct(code: ErrorCodes) {
    for (const timer of Object.values(this.nextTryRegister)) {
      clearTimeout(timer);
    }

    await Promise.allSettled(
      Object.values(this.mixers).filter(mixer =>
        mixer && mixer.status !== SsrItemStatus.STOPPED
      ).map(mixer => {
        mixer.clear();

        if (code === ErrorCodes.SERVER_RESTART) {
          return this._startStopMixer(mixer.id, false);
        } else {
          return this.stopMixer(mixer.id, 'session end');
        }
      })
    );

    for (const buffer of Object.values(this.speakBuffer)) {
      buffer.destruct();
    }

    this.mixers = {};
    this.tails = {};
    this.phantoms = {};
    this.speakBuffer = {};

    return super.beforeDestruct(code);
  }

  @ApmSpan()
  private onPresenterAvailable(value: boolean, roomid = '', id = '') {
    this.waitForPresenter(roomid, id, value,
      (value ? 'Please wait for the presenter to join the session.' : '')
    );

    if (!value) {
      this.waitForPresenter(roomid, id, false);

      const room: Room = this.inst.roomEngine.getRoomById(roomid);
      if (room && !room.enabledAllMic) {
        this.mute(room.id);
      }
    }
  }

  @ApmSpan()
  private onRefreshSettings() {
    if (
      this.inst.model.sessionSettings.audio[0] === SessionAudio.COMPUTER_ONLY
      || this.inst.model.sessionSettings.audio[0] === SessionAudio.EXTERNEL_LINE
    ) {
      for (const mixer of Object.values(this.mixers)) {
        if (mixer && mixer.status !== SsrItemStatus.STOPPED) {
          this.stopMixer(mixer.id, 'The session audio mode has been changed. Good bye.');
          mixer.clear();
        }
      }
    }
  }

  private waitForPresenter(rid, id, stat, msg = '') {
    if (rid === '*') {
      for (const r of Object.values(this.inst.model.roomsIndex)) {
        this.hold(r.id, id, stat, msg);
      }
    } else {
      this.hold(rid, id, stat, msg);
    }
  }

  private onPresenterAvailableTimeout(message: string) {
    for (const r of Object.values(this.inst.model.roomsIndex)) {
      this.kickout(r.id, '', message);
    }
  }

  // @todo add in models ServerRestAPI.PHONE_JOIN='participant-join' as soon as possible
  @Post(ServerRestAPI.PHONE_JOIN, [JwtSubjects.CORE_API_SERVER])
  @ApmTransaction(TransactionType.REQUEST)
  private onPhoneJoin(params: { aid: string, callSid: string }) {
    // @todo it seems Twilio need some time before be able to accept any commands
    setTimeout(() => this._onPhoneJoin(params), 300);
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private _onPhoneJoin({ aid, callSid }) {
    const id = (this.normalizeAid(aid) || callSid);

    const attendee = this.inst.model.attendeesIndex[id];

    const tail = this.getTail(id);

    if (tail) {
      tail.join = true;

      this.executeTail(tail).then(success => {
        if (success) {
          this.tails[tail.data.room || ''].delete(tail.id);
        }
      });
    }

    if (attendee?.room === '' && !this.inst.roomEngine.hasAnyPresenter) {
      this.waitForPresenter('', attendee.id, true, 'Please wait for the presenter to join the session.');
    }
  }

  @Post(ServerRestAPI.PHONE_SPEAKING, [JwtSubjects.CORE_API_SERVER])
  @ApmTransaction(TransactionType.REQUEST)
  private onPhoneSpeakingHandler({ aid, callSid, speaking }: {
    aid: Attendee['id'] | string,
    callSid: string,
    speaking: '0' | '1'
  }) {
    const id = this.normalizeAid(aid) || callSid;
    const attendee = this.inst.model.attendeesIndex[id];

    if (attendee && attendee.micState === MicState.denied) {
      return this.mute(attendee.room, attendee.id);
    }

    let attSpeakerBuffer = this.speakBuffer[id];
    if (!attSpeakerBuffer) {
      attSpeakerBuffer = new SpeakBuffer(() => {
        const stat = this.speakBuffer[id].status;
        delete this.speakBuffer[id];

        // if there has any action
        if (stat) {
          this.onPhoneSpeaking(id, (stat > 0));
        }
      });
      this.speakBuffer[id] = attSpeakerBuffer;
    }

    attSpeakerBuffer.change(!!parseInt(speaking, 10));
  }

  private onPhoneSpeaking(aid: string, status: boolean) {
    const a = this.inst.model.attendeesIndex[aid];
    const tail = this.getTail(aid);

    // @fixme Move all MicState.denied decisions in AudioModule but care about the performance.
    //        This is used in high rate but update process wants some amount of CPU AND RAM.

    if (tail) {
      if (status && (!a || a.micState !== MicState.denied)) {
        tail.data.micState = MicState.talking;
      } else {
        delete tail.data.micState;
      }

      return;
    }

    if (a && a.micState !== MicState.denied && a.phoneAudio) {
      // @fixme hack to avoid conflict with functionality in audio module
      a.micState = MicState.normal;

      this.inst.updateEngine.updateAttendee(null, a.id, { micState: (status ? MicState.talking : MicState.normal) });
    }
  }

  @Post(ServerRestAPI.PHONE_CALL, [JwtSubjects.CORE_API_SERVER])
  @ApmTransaction(TransactionType.REQUEST)
  private async onPhoneCall(params) {
    const status = params.status;
    const callsid = params.callsid;

    const aid = (this.normalizeAid(params.aid) || callsid);

    let data: Tail['data'] = { };
    let room = '';

    this.inst.logger.debug('<! --== PHONE DIAL ==-- !>', params);

    const attendee = this.inst.model.attendeesIndex[aid];

    // Fix when the request for end coming before the request for start
    // (when close the phone in short time after an attendee code inserting)
    if (!status) {
      if (!attendee || !attendee.phoneAudio) {
        this.phantoms[aid] = {
          sid: callsid,
          time: (new Date()).getTime()
        };
      }
    } else {
      if (this.phantoms[aid]) {
        const time = this.phantoms[aid].time + 10000 > (new Date()).getTime();

        delete this.phantoms[aid];

        // and last request for end is in less 10 secs
        if (time) {
          return;
        }
      }
    }

    if (attendee) {
      room = attendee.room;

      if (status) {
        data.phoneAudio = callsid;

        if (attendee.kickedOut) {
          this._kick([attendee.id], 'You have been kicked out of this session and are not allowed to rejoin');
          return;
        }

        if (attendee.left) {
          data.left = false;
          data.role = Roles.PHONE;
        }

        this.tails[''] = this.tails[''] || new Map() as TailMap;
        this.tails[''].set(aid, {
          id: aid,
          action: 'change',
          data: data,
          join: false,
        });

        // @todo <participant-join>
        if (room !== '') {
          setTimeout(() => this.onMoveTimeout('', room, aid, false), 2000);
        }
      } else {
        const cid = this.inst.connectionStorage.getClientId(attendee.id);

        if (attendee.phoneAudio == callsid) {
          data.phoneAudio = '';

          if (!cid) {
            data.left = true;
          }
          this.inst.updateEngine.updateAttendee(null, aid, data);
        }

        if (cid) {
          this.inst.server.sendTo(ClientConnectionAPI.PHONE_CALL_ME, '', cid);
        }

        this.tails[room]?.delete(aid);
      }
    } else {
      if (status) {
        this.phones++;

        room = '';

        data = {
          id: aid,
          userAccountID: callsid,
          firstName: params.firstName || `PhoneUser#${this.phones}`,
          lastName: params.lastName || '',
          role: params.role || Roles.PHONE,
        };

        if (params.uid) {
          data = await this.inst.fetchAttendeeInfo(aid);
        }

        data = {
          ...data,
          role: Roles.PHONE,
          staticRole: data.role,
          phoneAudio: callsid,
          micState: MicState.normal,
          left: false,
        };

        this.tails[''] = new Map() as TailMap;
        this.tails[''].set(aid, {
          id: aid,
          action: 'new',
          data,
          join: false,
        });
      } else {
        this.tails['']?.delete(aid);
      }
    }

    this.inst.logger.debug(`check tails status (${(this.tails[room]?.size || 0)}`, this.tails[room]?.entries());

    this.checkMixerStatus(room);
  }

  @ApmSpan()
  private checkMixerStatus(roomid: Room['id']): SsrItemStatus {
    this.createMixer(roomid);

    const hasTails = !!this.tails[roomid]?.size;

    this.inst.logger.debug(`<! --== check mixer status (${this.mixers[roomid].status}) ==-- !>`, { hasTails });

    if (hasTails) {
      if (this.mixers[roomid].status === SsrItemStatus.STOPPED) {
        this.startMixer(roomid);
      } else if (this.mixers[roomid].status === SsrItemStatus.PUBLISHED) {
        this.registTails(roomid);
      }
    } else {
      if (this.mixers[roomid].status === SsrItemStatus.PUBLISHED || this.mixers[roomid].status === SsrItemStatus.INIT) {
        const hasPhones = Object.values(this.inst.model.attendeesIndex).find(a => !!(a.room === roomid && a.phoneAudio));

        if (!hasPhones) {
          this.stopMixer(roomid);
        }
      }
    }
    return this.mixers[roomid].status;
  }

  @ApmSpan()
  private startMixer(roomid: Room['id']) {
    this.createMixer(roomid);

    if (this.mixers[roomid].status === SsrItemStatus.STOPPED) {
      this.mixers[roomid].status = SsrItemStatus.INIT;

      this._startStopMixer(roomid);
    } else if (this.mixers[roomid].status === SsrItemStatus.PUBLISHED) {
      this.registTails(roomid);
    }
  }

  @ApmSpan()
  private async stopMixer(roomid, kickAll = '', silent = false) {
    if (this.mixers[roomid] && this.mixers[roomid].status !== SsrItemStatus.STOPPED) {
      if (kickAll) {
        await this.kickout(roomid, '', kickAll);
      } else {
        this.mixers[roomid].status = SsrItemStatus.STOPPED;

        if (!silent) {
          await this._startStopMixer(roomid, false);
        }
      }
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onPhoneDiedOut(client, id) {
    const a: Attendee = this.inst.model.attendeesIndex[id];
    const s: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (a && s.hasBaton || s.id === a.id) {
      this.kickout(a.room, a.id, '');
      const data: any = {
        phoneAudio: ''
      };
      if (a.role === Roles.PHONE) {
        data.left = true;
      }
      this.inst.updateEngine.updateAttendee(null, a.id, data);
    }
  }

  // Event requested from media server for stream started
  @ApmSpan()
  private onStartMixer(roomid) {
    if (this.mixers[roomid]) {
      const mixerClient: Attendee = Object.values(this.inst.model.attendeesIndex).find(
        a => (a.staticRole === Roles.MIXER && !a.left && a.room === roomid));

      this.inst.logger.debug(`<! --== Mixer Client  (${roomid}) is ${(mixerClient ? 'ON' : 'OFF')}) ==-- !>'`);

      if (mixerClient && this.inst.model.sessionSettings.audio[0] === SessionAudio.COMPUTER_AND_PHONE) {

        this.inst.logger.debug('<! --== Send Twilio Ready ==-- !>');
        this.inst.sendToAttendee(mixerClient.id, ClientConnectionAPI.TWILIO_READY);
      }

      this.mixers[roomid].status = SsrItemStatus.PUBLISHED;

      this.registTails(roomid);
    }
  }

  @ApmSpan()
  private async registTails(roomid) {
    for (const tail of this.tails[roomid]?.values() || []) {
      if (await this.executeTail(tail)) {
        this.tails[roomid].delete(tail.id);
      }
    }
  }

  private async executeTail(tail: Tail): Promise<boolean> {
    const roomid = tail.data.room || '';

    if (!tail.join || !this.mixers[roomid] || this.mixers[roomid].status !== SsrItemStatus.PUBLISHED) {
      return false;
    }

    let attendee = this.inst.model.attendeesIndex[tail.id];

    if (attendee) {
      // if computer has been combing
      tail.data.role = attendee.role;

      if (attendee.micState === MicState.talking) {
        tail.data.micState = MicState.normal;
      }

      let isEmptyData = true;
      const updateData =  Object.entries(tail.data).reduce(
        (attendeeChanges, [key, value]) => {
          if (value !== attendee[key]) {
            attendeeChanges[key] = value;
            isEmptyData = false;
          }
          return attendeeChanges;
        },
        {} as Partial<Attendee>
      );

      if (!isEmptyData) {
        await this.inst.updateEngine.updateAttendee(null, attendee.id, updateData);
      }

      if (attendee.id === '' && !this.inst.roomEngine.hasAnyPresenter) {
        this.onPresenterAvailable(true, attendee.room, attendee.id);
      }
    } else {
      await this.inst.setupNewUser(tail.data as Partial<AttendeeBase>);

      attendee = this.inst.model.attendeesIndex[tail.id];
    }

    if (attendee && (attendee.micState === MicState.denied)) {
      this.mute(attendee.room, attendee.id);
    }

    return true;
  }

  @ApmSpan()
  private getTail(aid: Attendee['id']): Tail | null {
    for (const roomid in this.tails) {
      const roomTails = this.tails[roomid];

      for (const tail of roomTails.values()) {
        if (tail.id === aid) {
          return tail;
        }
      }
    }

    return null;
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private onMoveTimeout(from, to, id, hasJoin) {
    this.move(from, to, id, hasJoin);
  }

  private move(from, to, id, hasJoin) {
    const roomTo: Room = this.inst.roomEngine.getRoomById(to);

    if (roomTo) {
      const cid = [];

      if (id) {
        let _cid;
        let close = true;
        for (const [i, t] of this.tails[from]?.entries() || []) {
          if (t.id === id) {
            this.tails[from].delete(i);

            t.data.room = to;
            t.join = false;

            this.tails[to] = this.tails[to] || new Map() as TailMap;
            this.tails[to].set(id, t);

            _cid = t.data.phoneAudio;
          } else {
            close = false;
          }
        }

        if (!_cid && this.inst.model) {
          for (const a of Object.values(this.inst.model.attendeesIndex)) {
            if (a.phoneAudio && a.room === from) {
              if (a.id === id) {
                _cid = a.phoneAudio;

                this.tails[to] = this.tails[to] || new Map() as TailMap;
                this.tails[to].set(a.id, {
                  id: a.id,
                  action: 'change',
                  data: {
                    room: to,
                    phoneAudio: a.phoneAudio
                  },
                  join: false,
                });
              } else {
                close = false;
              }
            }
          }
        }

        if (_cid) {
          cid.push(_cid);
        }

        if (close) {
          this.stopMixer(from);
        }
      } else {
        for (const [i, t] of this.tails[from]?.entries() || []) {
          this.tails[from].delete(i);

          t.data.room = to;
          t.join = false;

          this.tails[to] = this.tails[to] || new Map() as TailMap;
          this.tails[to].set(id, t);

          cid.push(t.data.phoneAudio);
        }

        if (this.inst.model) {
          for (const a of Object.values(this.inst.model.attendeesIndex)) {
            if (a.id === id && a.phoneAudio && a.room === from) {
              cid.push(a.phoneAudio);

              this.tails[to] = this.tails[to] || new Map() as TailMap;
              this.tails[to].set(a.id, {
                id: a.id,
                action: 'change',
                data: {
                  room: to,
                  phoneAudio: a.phoneAudio
                },
                join: false,
              });
            }
          }
        }

        this.stopMixer(from);
      }

      if (cid.length) {
        this.startMixer(to);

        this._move(to, cid, hasJoin);
      }
    }
  }

  private async kickout(roomid, id = '', message = '') {
    const cid = [];
    let close = true;
    if (id) {
      let _cid;
      for (const [i, t] of this.tails[roomid]?.entries() || []) {
        if (t.id === id) {
          _cid = t.data.phoneAudio;
          this.tails[roomid].delete(i);
        } else {
          close = false;
        }
      }
      if (!_cid && this.inst.model) {
        for (const a of Object.values(this.inst.model.attendeesIndex)) {
          if (a.phoneAudio && a.room === roomid) {
            if (a.id === id) {
              _cid = a.phoneAudio;
            } else {
              close = false;
            }
          }
        }
      }

      if (_cid) {
        cid.push(_cid);
      }
      if (close) {
        await this.stopMixer(roomid);
      }
    } else {
      for (const [i, t] of this.tails[roomid]?.entries() || []) {
        this.tails[roomid].delete(i);
        cid.push(t.data.phoneAudio);
      }
      if (this.inst.model) {
        for (const a of Object.values(this.inst.model.attendeesIndex)) {
          if (a.phoneAudio && a.room === roomid) {
            cid.push(a.phoneAudio);
          }
        }
      }
      this.tails[roomid] = new Map() as TailMap;

      await this.stopMixer(roomid);
    }

    if (cid.length) {
      await this._kick(cid, message);
    }
  }
  private hold(roomid, id = '', status = true, message = '') {
    const cid = [];
    if (id) {
      let _cid;
      for (const tail of this.tails[roomid]?.values() || []) {
        if (tail.id === id) {
          _cid = tail.data.phoneAudio; return false;
        }
      }
      if (!_cid && this.inst.model) {
        const a = this.inst.model.attendeesIndex[id];
        if (a && a.phoneAudio) {
          _cid = a.phoneAudio;
        }
      }
      if (_cid) {
        cid.push(_cid);
      }
    } else {
      for (const tail of this.tails[roomid]?.values() || []) {
        cid.push(tail.data.phoneAudio);
      }
      if (this.inst.model) {
        for (const a of Object.values(this.inst.model.attendeesIndex)) {
          if (a.room === roomid && a.phoneAudio) {
            cid.push(a.phoneAudio);
          }
        }
      }
    }
    if (cid.length) {
      this._hold(cid, status, message);
    }
  }

  private mute(roomid, id = '', status = true) {
    const cid = [];
    if (id) {
      const a = this.inst.model.attendeesIndex[id];
      if (a && a.phoneAudio) {
        cid.push(a.phoneAudio);
      }
    } else {
      for (const a of Object.values(this.inst.model.attendeesIndex)) {
        if (a.room === roomid && a.phoneAudio) {
          cid.push(a.phoneAudio);
        }
      }
    }

    if (cid.length) {
      this._mute(cid, status);
    }
  }

  @ApmSpan()
  private async _startStopMixer(roomid, start = true) {
    clearTimeout(this.nextTryRegister[roomid]);

    this.inst.logger.debug(`<! --== ${(start ? 'START' : 'STOP')} MIXER IN ROOM (${roomid}) ==-- !>`);

    const item = this.mixers[roomid];

    if (!item) {
      const error = new Error(`Does not exist item for (${roomid})`);
      apm.captureError(error);
      this.inst.logger.error(error.message);
      return;
    }

    if (item.worker) {
      try {
        item.clear();
        const worker = item.worker;
        worker.observer.removeListener('message', this._onChangeStatus);
        worker.stop();
      } catch (error) {
        // Catch some abnormal errors while stopping and only log them
        // noop
        apm.captureError(error);
        this.inst.logger.error(error.message);
      }
    }
    item.worker = null;
    if (!start) {
      return;
    }

    const workerFactory = mixerFactoryPromise;
    try {
      await workerFactory.start();
    } catch (err) {
      // TODO:  add a retry mechanism, ticket #9813
      apm.captureError(err);
      this.inst.logger.error(err.message);
      return;
    }

    let tokenSet: TokenSet = null;
    try {
      tokenSet = await getGhostUserAuth();
    } catch (err) {
      // TODO:  add a retry mechanism, ticket #9813
      apm.captureError(err);
      this.inst.logger.error(err.message);
      return;
    }

    const url = '' + Object.assign(
      new URL('/Conference/', config.get('appUrl')),
      {
        hash: '' + new URLSearchParams({
          mid: this.inst.model.meetingID,
          aid: this.inst.model.sessionSettings.hostID,
          rid: item.id,
          mode: 'mixer',
          id_token: tokenSet.access_token,
          debug: '1'
        })
      }
    );

    if (item.status === SsrItemStatus.INIT) {
      const startTaskQueuePac = MixerBoxJob.fromAny({
        mrid: this.inst.model.meetingID,
        url: url,
        userId: `mixer-user-${item.id ? item.id : this.inst.model.meetingID}`,
        roomId: `${this.inst.model.meetingID}${item.id ? '_' + item.id : ''}`
      });

      item.worker = new MixerController(
        workerFactory,
        (this.inst.model.meetingID + item.id),
        startTaskQueuePac,
        this.inst.logger
      );

      item.worker.start();
      item.worker.observer.on('message', this._onChangeStatus);
    }
  }

  @ApmSpan()
  private async _move(roomid: string, cid: string[], hasJoin = false) {
    this.inst.logger.debug(`<! --== PHONE (${cid}) MOVE IN ROOM (${roomid}) ==-- !>`);
    try {
      await coreApi.post<void>(
        RestAPI.TWILIO_MOVE,
        {
          mid: this.inst.model.meetingID,
          cid: cid.join(','),
          to: this.inst.model.meetingID + roomid,
          hasJoin: (hasJoin ? 1 : 0)
        }
      );
    } catch (err) {
      apm.captureError(err);
      this.inst.logger.error(err.message);
    }
  }

  @ApmSpan()
  private async _kick(cid: string[], message: string) {
    this.inst.logger.debug(`<! --== PHONE (${cid}) GOT KICKOUT (${message}) ==-- !>`);
    try {
      await coreApi.post<void>(
        RestAPI.TWILIO_KICKOUT,
        {
          mid: this.inst.model.meetingID,
          cid: cid.join(','),
          msg: message
        }
      );
    } catch (err) {
      apm.captureError(err);
      this.inst.logger.error(err.message);
    }
  }

  @ApmSpan()
  private async _hold(cid: string[], status: boolean, message: string) {
    this.inst.logger.debug(`<! --== PHONE (${cid}) ${(status ? 'HOLD' : 'UNHOLD')} (${message}) ==-- !>`);

    try {
      await coreApi.post<void>(
        RestAPI.TWILIO_HOLD,
        {
          mid: this.inst.model.meetingID,
          cid: cid.join(','),
          msg: message,
          hold: (status ? 1 : 0),
        }
      );
    } catch (err) {
      apm.captureError(err);
      this.inst.logger.error(err.message);
    }
  }

  @ApmSpan()
  private async _mute(cid: string[], status: boolean) {
    this.inst.logger.debug(`<! --== PHONE (${cid}) ${(status ? 'MUTE' : 'UNMUTE')} ==-- !>`);

    try {
       await coreApi.post<void>(
         RestAPI.TWILIO_MUTE,
         {
           mid: this.inst.model.meetingID,
           cid: cid.join(','),
           mute: (status ? 1 : 0),
         }
       );
    } catch (err) {
      apm.captureError(err);
      this.inst.logger.error(err.message);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private async callMe(client: Client, {ext, code: phoneCode, phone}) {
    const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (a && !a.phoneAudio) {
      try {
        const {data, status} = await coreApi.post<void>(
          RestAPI.TWILIO_CALL_ME,
          {
            mid: this.inst.model.meetingID,
            aid: a.id,
            extension: ext,
            phone: phoneCode + phone,
            isInBOR: (a.room ? 1 : 0)
          }
        );
        this._callMe(client, status, data);
      } catch (err) {
        err = err as AxiosError | Error;
        this._callMe(client, err.response?.status || 500, err.response?.statusText || err.message);
      }
    }
  }

  @ApmSpan()
  private _callMe(client, code, message) {
    this.inst.server.sendTo(ClientConnectionAPI.PHONE_CALL_ME, { code, message }, client.id);

    if (code !== 200) {
      setTimeout(() => { this.inst.server.sendTo(ClientConnectionAPI.PHONE_CALL_ME, null, client.id); }, 15000);
      const error = new Error(`CALLME FAIL [${code}] ${message}`);
      apm.captureError(error);
      this.inst.logger.error(error.message);
    } else {
      this.inst.logger.debug(`CALLME SUCCESS [${message}`);
    }
  }

  private normalizeAid(aid) {
    aid = aid.toString();
    if (aid === '' || aid === '0' || aid === 'false') {
      return '';
    }
    return aid;
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private changeStatus(data: TaskMessage) {
    this.inst.logger.debug('<! --== MIXER BOX CHANGE STATUS ==-- !>', data);

    const roomid = data.jobId.replace(this.inst.model.meetingID, '');
    const item = this.mixers[roomid];
    if (!item) {
      return;
    }

    switch (data.status) {
      case TaskStatus.WORKING:
        this.onStartMixer(item.id);
        break;
      case TaskStatus.DONE:
        this.stopMixer(item.id);
        break;
      case TaskStatus.FAILED: {
        clearTimeout(this.nextTryRegister[item.id]);

        if (item.status !== SsrItemStatus.INIT) {
          item.status = SsrItemStatus.INIT;
        }
        this.nextTryRegister[item.id] = setTimeout(
          () => this.onNextTryStart(item),
          this.nextTryTime
        );

        break;
      }
    }
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private onNextTryStart(item: MixerItem) {
    this.nextTryRegister[item.id] = null;

    if (item.status !== SsrItemStatus.STOPPED) {
      this._startStopMixer(item.id, true);
    }
  }

  @ApmSpan()
  private createMixer(rid: Room['id']) {
    if (!this.mixers[rid]) {
      this.mixers[rid] = new MixerItem(rid, this.inst);
      this.mixers[rid].onStartOut = (item) => this.kickout(item.id);
    }
  }
}
