import apm from 'elastic-apm-node/start';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import BaseModule, { StateInterface } from './BaseModule';
import Meeting from '../Meeting';
import {
  ClientConnectionAPI,
  ServerRestAPI,
  SessionSettings,
  ServerConnectionAPI,
  RestAPI,
  Attendee,
  UpdateMessageData,
  SessionSettingsUsingOtherCases,
  AttendeeBase,
  ErrorCodes,
  Roles
} from '@container/models';
import { AppInstanceMessagingEvents } from '../../../utils/AppInstance';
import { MeetingMessagingCommands } from '../events/MessagingAPI';
import { SessionEventTypes } from '../events/SessionEvents';
import { coreApi } from '../../../utils/coreApiClient';
import { Get, Post } from '../../../gateway/decorators/method.decorator';
import { res } from '../../../gateway/decorators/argument.decorator';
import serverConfig from '../../../utils/serverConfig';
import { ServerResponse } from '../../../utils/Server';
import { JwtSubjects } from '../../../gateway/types';
import { DB_COLLECTIONS, defaultDb } from '../../../database';

export interface AttendeesState extends StateInterface {
  attendees: AttendeeBase[];
}

export default class AdminEngine extends BaseModule {
  protected stateCollection = defaultDb().collection(DB_COLLECTIONS.ATTENDEES_STATE);

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);

    this.inst.server.onSocket(ServerConnectionAPI.LOAD_SESSION_SETTINGS, () => this.onLoadSessionSettings());

    this.inst.server.onMessage(AppInstanceMessagingEvents.INIT, ({data, source}) => this.onAdminAppInit(data, source));
    this.inst.eventBus.on(SessionEventTypes.SESSION_INIT, () => {
      this.inst.server.sendMessage(AppInstanceMessagingEvents.INIT, JSON.parse(JSON.stringify(this.inst.model)));
    });
  }

  async beforeDestruct(code: ErrorCodes) {
    if (code === ErrorCodes.SERVER_RESTART) {
      await this.saveState();
    }
    return super.beforeDestruct(code);
  }

  @ApmSpan()
  async loadMeetingSettings() {
    const logger = this.inst.logger;

    const { data: settings } = await coreApi.get<Partial<SessionSettings & SessionSettingsUsingOtherCases>>(
      `${RestAPI.LOAD_SESSION_SETTINGS}/${encodeURIComponent(this.inst.model.meetingID)}`
    );

    const phoneLocked = this.inst.model.phoneLocked;

    const oldSettings = {...this.inst.model.sessionSettings};

    this.inst.model.sessionSettings = new SessionSettings(settings);
    this.inst.model.phoneLocked = !(this.inst.model.sessionSettings.allowPhoneForAll);

    if (this.inst.model.phoneLocked !== phoneLocked) {
      const updateList = [];

      for (const [id, attendee] of Object.entries(this.inst.model.attendeesIndex)) {
        if (attendee.phoneLocked !== this.inst.model.phoneLocked) {
          updateList.push({ id, data: { 'phoneLocked': this.inst.model.phoneLocked } });
        }
      }

      await Promise.all(updateList.map(item => this.inst.updateEngine.approveAndApplyData(null, item)));
    }

    this.inst.logger.debug('Session settings were loaded successfully');

    await this.loadState();

    logger.debug(`Setting name anonymity to: "${this.inst.model.sessionSettings.anonymizeMode}"`);

    Attendee.anonymity = this.inst.model.sessionSettings.anonymizeMode;
    Attendee.codec = this.inst.model.sessionSettings.nameFormat;

    this.inst.eventBus.emit(SessionEventTypes.REFRESH_SETTINGS, {oldSettings, settings});
  }

  @ApmSpan()
  async approveAttendeeChange(client, id, data, done) {
    await done(data);

    this.inst.server.sendMessage(MeetingMessagingCommands.ATTENDEE_UPDATE, new UpdateMessageData(id, data));
  }

  @ApmSpan()
  onAddAttendee(a: Attendee){
    this.inst.server.sendMessage(MeetingMessagingCommands.ATTENDEE_JOIN, {...a});
  }

  @ApmSpan()
  onRemoveAttendee(id: string){
    this.inst.server.sendMessage(MeetingMessagingCommands.ATTENDEE_REMOVE, id);
  }

  @Get(ServerRestAPI.RESET_SESSION) // @SUT
  private async onResetSession(@res res: ServerResponse, { code }) {
    if (!serverConfig.CONFIG.sut.enabled) {
      return;
    }

    await this.inst.server.shutdown(undefined, +code || ErrorCodes.KILL);

    res.send(200);
  }

  @Post(ServerRestAPI.SESSION_EDIT, [JwtSubjects.LEGACY_BACKEND])
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onSessionEdit(@res res: ServerResponse, params: Partial<SessionSettings> & Partial<SessionSettingsUsingOtherCases>) {
    this.inst.logger.debug('Update session settings', JSON.stringify(params));

    try {
      const cid = this.inst.connectionStorage.getClientId(this.inst.model.sessionSettings.hostID);

      if (cid) {
        this.inst.server.sendTo(ClientConnectionAPI.SETTINGS_UPDATED, undefined, cid);
      }

      res.send(200);
    } catch (err) {
      res.send(406, err.message);
    }

  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private async onLoadSessionSettings() {
    try {
      await this.loadMeetingSettings();

      // Here we just clear layout settings for main room and we do not notify attendees for that we rely on window reload in client
      this.inst.layoutEngine.clearLayoutSettings('');

      this.inst.server.sendTo(ClientConnectionAPI.SETTINGS_UPDATE, { settings: this.inst.model.sessionSettings });

      this.inst.roomEngine.resetRooms();
    } catch (error) {
      apm.captureError(error);
      this.inst.logger.error(`Load session setting failed. ${error.message}`);
    }
  }

  private onAdminAppInit(data, {name, type}){
    if(type === 'admin' && this.inst.name === name){
      this.inst.server.sendMessage(AppInstanceMessagingEvents.INIT, JSON.parse(JSON.stringify(this.inst.model)));
    }
  }

  @ApmSpan()
  protected populateState({ attendees }: AttendeesState) {
    for (const attendeeBase of attendees) {
      if (attendeeBase.id) {
        const attendee = this.inst.attendeeStorage.addAttendee(attendeeBase);

        this.inst.setupRemoveAttendeeDelay(attendee.id);
      }
    }
  }

  @ApmSpan()
  protected async serializeState(): Promise<AttendeesState> {
    const attendees = await Promise.all(Object.values(
      this.inst.model.attendeesIndex
    ).filter(
      attendee =>
        // !attendee.left && // @todo check and fix the left hack in Meeting
        attendee.role !== Roles.GHOST
    ).map(async attendee => {
      if (attendee.role !== Roles.PHONE) {
        await this.inst.updateEngine.approveAndApplyData(null, {id: attendee.id, data: { left: true, app: '' }});
      }

      const json = attendee.toJSON() as AttendeeBase;

      return json;
    }));

    return { attendees };
  }
}
