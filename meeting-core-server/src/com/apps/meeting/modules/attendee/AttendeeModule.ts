import apm from 'elastic-apm-node/start';
import {
  Attendee,
  AttendeeBase,
  ClientConnectionAPI,
  ErrorCodes,
  KickOutData,
  RestAPI,
  Roles,
  Room,
  ServerConnectionAPI,
  ServerRestAPI,
  UpdateMessageData,
  MediaConnStrength, WhiteboardType
} from '@container/models';
import { ApmSpan, ApmTransaction, FunctionalDomainType, TransactionType } from '@container/apm-utils';
import Client from '../../../../utils/Client';
import {client as dClient, res as dRes} from '../../../../gateway/decorators/argument.decorator';
import serverConfig from '../../../../utils/serverConfig';
import Meeting from '../../Meeting';
import BaseModule from './../BaseModule';
import { MeetingMessagingCommands } from '../../events/MessagingAPI';
import { coreApi } from '../../../../utils/coreApiClient';
import { ServerResponse } from '../../../../utils/Server';
import { Post, Socket } from '../../../../gateway/decorators/method.decorator';
import { JwtSubjects } from '../../../../gateway/types';
import { publishKafkaEvent } from '../../../../utils/kafka-publisher';
import { ActiveMeetingEvent, ActiveMeetingEventPayload } from '../../kafka/fa-event-types';
import uuid from 'uuid';
import { LogTriggerType } from '../event-log/event-log-types';
import KafkaUtils from '../../kafka/kafka-utils';

export default class AttendeeModule extends BaseModule {

  private shutdownTimer = null;

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);

    this.inst.server.onSocket(ServerConnectionAPI.ATT_CONFIRMED_AUTO_ROOM_CHECK, (_, aid: string) => {
      this.roomCheckConfirmed(aid, LogTriggerType.Timeout);
    });
    this.inst.server.onSocket(ServerConnectionAPI.ATT_CONFIRMED_MANUAL_ROOM_CHECK, (_, aid: string) => {
      this.roomCheckConfirmed(aid, LogTriggerType.Room);
    });
    this.inst.server.onSocket(ServerConnectionAPI.AUTO_ROOM_CHECK, (client, aid: string) => this.autoRoomCheck(client, aid));
    this.inst.server.onSocket(ServerConnectionAPI.ROOM_CHECK, (client, data) => this.roomCheck(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.ATT_BEFORE_AUTO_REMOVE, (client, data) => this.attBeforeAutoRemove(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.CLOSE_ROOM_CHECK_ALERT, (client, data) => this.closeRoomCheckAlert(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.LOGOUT, (client, data) => this.logout(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.KICK_OUT_USER, (client, data) => this.kickOut(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.CHANGE_ROLE, (client, data) => this.onChangeRole(client, data));

    this.inst.server.onSocket(ServerConnectionAPI.LOCK_PHONE_AUDIO, (client, data) => this.onPhoneLock(client, data));

    this.inst.server.onMessage(MeetingMessagingCommands.ATTENDEE_MAKE_LEAD, data => this.setLeadBorManager(data));
    this.inst.server.onMessage(MeetingMessagingCommands.ATTENDEES_ASSIGN_REMOVE, data => this.onBorAttendeesAssignRemove(data));
  }
  destruct() {
    clearTimeout(this.shutdownTimer);
    return super.destruct();
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  attBeforeAutoRemove(client, data) {
    const att: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!!att) {
      const sendPackage = { roomId: att.room, data };
      data.initiatorId ?
        this.inst.sendToAttendee(data.initiatorId, ClientConnectionAPI.AUTO_REMOVE_ATTENDEE_NOTIFICATION, sendPackage) :
        this.inst.roomEngine.sendToRoomMainPresentersWithFallback(
          att.room, ClientConnectionAPI.AUTO_REMOVE_ATTENDEE_NOTIFICATION, sendPackage
        );
    } else {
      this.inst.logger.debug('attBeforeAutoRemove: Attendee cannot be found.');
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  closeRoomCheckAlert(client, data) {
    const att: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!!att) {
      this.inst.server.sendTo(ClientConnectionAPI.CLOSE_ROOM_CHECK_ALERT, { roomId: att.room, data });
    } else {
      this.inst.logger.debug('closeRoomCheckAlert: Attendee cannot be found.');
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  logout(client, data) {
    const att: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!!att) {
      this.inst.server.sendTo(ClientConnectionAPI.LOGOUT, { target: att.room, data });
      this.inst.server.sendTo(ClientConnectionAPI.UPDATE_ROOM_CHECK_NOTIFICATION_LIST, { target: att.room, data });
    } else {
      this.inst.logger.debug('logout: Attendee cannot be found.');
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  roomCheckConfirmed(aid: string, checkType: string) {
    const attendee: Attendee = this.inst.model.attendeesIndex[aid];
    const kEvent = this.createKafkaRoomCheckEvent('RoomCheckConfirmed', attendee, checkType);
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  autoRoomCheck(client, aid: string) {
    const attendee: Attendee = this.inst.model.attendeesIndex[aid];

    if (this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      this.inst.logger.debug('Unexpected Action in AttendeeModule for Test Room.');
      return;
    }

    const kEvent = this.createKafkaRoomCheckEvent('RoomCheck', null, LogTriggerType.Timeout, 1, attendee.room);
    publishKafkaEvent(kEvent, this.inst.model.meetingID);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  roomCheck(client, data) {
    const senderAttendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const targetAttendee: Attendee = this.inst.model.attendeesIndex[data.target];

    if (this.inst.roomEngine.getRoomById(senderAttendee.room).isTestRoom) {
      this.inst.logger.debug('Unexpected Action in AttendeeModule for Test Room.');
      return;
    }

    if (this.inst.roomEngine.isRoomPresenter(senderAttendee, senderAttendee.room)) {
      const targetAttendeesCount = targetAttendee
        ? 1
        : KafkaUtils.getAttendeesCount(this.inst.model.attendeesIndex, senderAttendee.room, senderAttendee.id);

      const kEvent = this.createKafkaRoomCheckEvent(
        'RoomCheck',
        senderAttendee,
        LogTriggerType.Room,
        targetAttendeesCount,
        senderAttendee.room
      );
      publishKafkaEvent(kEvent, this.inst.model.meetingID, senderAttendee.role);

      if (targetAttendee) {
        this.inst.sendToAttendee(
          targetAttendee.id, ClientConnectionAPI.ROOM_CHECK, { roomId: targetAttendee.room, data, initiatorId: senderAttendee.id}
        );
        return;
      }

      this.inst.roomEngine.sendToRoom(senderAttendee.room, ClientConnectionAPI.ROOM_CHECK, {
        roomId: senderAttendee.room,
        data, initiatorId: senderAttendee.id
      });
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  async kickOut(client, data: KickOutData) {
    const target: Attendee = this.inst.model.attendeesIndex[data.id];
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!target || !sender ||
      target.role === Roles.HOST ||
      (sender.role !== Roles.HOST && target.role === Roles.COHOST) ||
      (sender.role !== Roles.HOST && !sender.hasBaton)
    ) {
      return;
    }

    const kEvent = this.createKafkaRoomCheckEvent('RoomCheck', sender, LogTriggerType.Attendee, 1, sender.room);
    publishKafkaEvent(kEvent, this.inst.model.meetingID, sender.role);

    if (!data.kickOut) {
      return this.onKickout(client, target, data.reason, data.kickOut, true);
    }

    // TODO: Decouple / remove the `coreApi.post` request given the SS is the owner of the Active Meeting, any other notifications should be done as post side effects, not as pre-conditions that can fail / block the operation!
    try {
      await coreApi.post<void>(
        RestAPI.KICK_OUT,
        {
          kickedAid: data.id,
          reason: data.reason,
          minutes: (60 * 24)
        }
      );
      this.onKickout(client, target, data.reason, data.kickOut, true);
    } catch (err) {
      apm.captureError(err);
      this.inst.logger.error(err.message, {aid: client.data.aid});
    }
  }

  @ApmSpan()
  onRemoveAttendee(id: string) {
    const a: Attendee = this.inst.model.attendeesIndex[id];

    if (!serverConfig.CONFIG.autopromoteLead || !a || !a.room || a.role !== Roles.LEAD) {
      return;
    }

    const mainRoom: Room = this.inst.roomEngine.getRoomById('');
    // we need this, so we can set new lead, when lead leaves or was kicked out
    this.resolveRole(a, { room: '' }, mainRoom);
  }

  @ApmSpan()
  async approveAttendeeChange(client, id, data, done) {
    const targetAttendee: Attendee = this.inst.model.attendeesIndex[id];
    const targetAttendeeRoom: Room = this.inst.roomEngine.getRoomById(targetAttendee.room);

    if (client) {
      const senderAttendee = this.inst.model.attendeesIndex[client.data.aid];

      // this would be very weird, but just to be sure
      if (!senderAttendee) {
        done(null);
        return;
      }

      const senderAttendeeRoom = this.inst.roomEngine.getRoomById(senderAttendee.room);

      if (
        ('role' in data || 'staticRole' in data) &&
        !this.canAssignRole(senderAttendee, targetAttendee, senderAttendeeRoom, targetAttendeeRoom)
      ) {
        this.onKickout(null, senderAttendee, 'Unauthorized privilege escalation');

        return done(null);
      }
    }

    if (!targetAttendee || !targetAttendeeRoom) {
      return done(data);
    }

    if (data.attendeeAdded !== undefined) {
      const lockPhone = !(this.inst.model.sessionSettings.allowPhoneForAll) && this.inst.model.phoneLocked;
      if (targetAttendee.phoneLocked !== lockPhone) {
        data.phoneLocked = lockPhone;
      }
    }

    let newRole;
    if (data.room !== undefined) {
      const targetRoom = this.inst.model.roomsIndex[data.room];
      newRole = this.resolveRole(targetAttendee, data, targetRoom);
    } else {
      newRole = this.resolveRole(targetAttendee, data, targetAttendeeRoom);
    }

    if (!data.left && targetAttendee.role !== newRole && data.role !== newRole) {
      data.role = newRole;
    }

    await done(data);

    // ensure in case there has other connected (mixers, recorders,...) after last attendee left the instance will shutdown
    if (data.left !== undefined || data.phoneAudio) {
      const any = Object.values(this.inst.model.attendeesIndex).find(aa =>
        !aa.left && aa.role !== Roles.GHOST && aa.role !== Roles.PHONE
      );

      if (!any) {
        if (this.shutdownTimer === null) {
          this.shutdownTimer = setTimeout(() => this.inst.server.shutdown(), serverConfig.CONFIG.socketServerConfig.roomKeepAlive * 1000);
          this.inst.logger.debug(`<!--== SETUP ATTENDEE MODULE SHUTDOWN TIMER (${serverConfig.CONFIG.socketServerConfig.roomKeepAlive}) ==--!>`);
        }
      } else {
        if (this.shutdownTimer !== null) {
          clearTimeout(this.shutdownTimer);
          this.shutdownTimer = null;
          this.inst.logger.debug(`<!--== CLEAR ATTENDEE MODULE SHUTDOWN TIMER ==--!>`);
        }
      }
    }
  }

  @ApmSpan()
  private resolveRole(attendee: Attendee, data: AttendeeBase, targetRoom: Room): Roles {
    if (attendee.staticRole === Roles.PRESENTER && !this.inst.roomEngine.hasActiveMainRoomPresenter()) {
      return Roles.COHOST;
    }

    // if data.staticRole is set we want to set it as current role of the attendee as well
    if (data.staticRole) {
      return data.staticRole;
    }

    // if data.role is set we just return that, as that will be the new attendee role either way
    if (data.role) {
      return data.role;
    }

    // @deprecated - remove Lead autopromotion with old bor manager
    if (data.room !== undefined && serverConfig.CONFIG.autopromoteLead) {
      if (attendee.room !== '' && attendee.role === Roles.LEAD) {
        // the lead is leaving the room and we need to set a new lead
        const newLead: Attendee = this.inst.roomEngine.getRoomLeadCandidate(attendee.room, attendee.id);
        const oldRoom: Room = this.inst.model.roomsIndex[attendee.room];
        if (newLead && oldRoom) {
          this.setRole(null, Roles.LEAD, newLead, oldRoom);
        } else if (oldRoom) {
          this.inst.roomEngine.updateRoom(oldRoom.id, { currentLeadId: '' });
        }
      }

      if (
        data.room !== '' &&
        targetRoom && !targetRoom.currentLeadId && !targetRoom.isTestRoom &&
        this.inst.roomEngine.isRoomEmpty(data.room) &&
        (attendee.role === Roles.ATTENDEE || attendee.role === Roles.PRESENTER || attendee.role === Roles.LEAD)
      ) {
        // first attendee in a BOR - autopromote to LEAD
        this.inst.roomEngine.updateRoom(targetRoom.id, { currentLeadId: attendee.id });
        return Roles.LEAD;
      }
    }

    // we check if attendee is eligible for Lead OR is already Lead but shouldn't be
    if (attendee.id === targetRoom.currentLeadId &&
      attendee.role !== Roles.COHOST &&
      attendee.role !== Roles.PHONE &&
      attendee.role !== Roles.HOST) {
      return Roles.LEAD;
    } else if (attendee.role === Roles.LEAD) {
      return attendee.staticRole;
    }

    // no change of role needed
    return attendee.role;
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onPhoneLock(client: Client, locked: boolean) {
    this.inst.model.phoneLocked = locked;

    const pac = [];
    for (const a of Object.values(this.inst.model.attendeesIndex)) {
      if (a.phoneLocked !== locked && a.role !== Roles.GHOST) {
        pac.push(new UpdateMessageData(a.id, { phoneLocked: this.inst.model.phoneLocked }));
      }
    }

    if (pac.length) {
      this.inst.updateEngine.updateAttendees(client, pac);
      this.inst.server.sendTo(ClientConnectionAPI.LOCK_PHONE_AUDIO, this.inst.model.phoneLocked);
    }
  }

  @ApmSpan()
  private async onKickout(client: Client, a: Attendee, msg: string, isBanned: boolean = false, sendToKafka: boolean = false) {
    await this.inst.updateEngine.updateAttendee(client, a.id, { kickedOut: msg });

    const cid = this.inst.connectionStorage.getClientId(a.id);
    if (cid) {
      this.inst.server.disconnect(cid, ErrorCodes.GOT_KICKOUT, msg);
    }

    if (sendToKafka) {
      const kEvent = this.createKafkaRoomCheckKickoutEvent(a, LogTriggerType.Attendee, msg, isBanned);
      publishKafkaEvent(kEvent, this.inst.model.meetingID, a.role);
    }
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  protected onBorAttendeesAssignRemove({ data, source }: any) {
    if (source.type === 'admin' && this.inst.name === source.name) {
      const room: Room = this.inst.model.roomsIndex[data.borId];
      // demote the current lead to an attendee when attendee is reassigned from bor
      if (room && room.currentLeadId) {
        const findLeadId = data.attendeesList.find(attId => room.currentLeadId === attId);
        if (findLeadId) {
          const currentLead = this.inst.model.attendeesIndex[findLeadId];
          this.inst.roomEngine.updateRoom(room.id, { currentLeadId: '' });
          if (currentLead) {
            this.inst.updateEngine.updateAttendee(null, currentLead.id, { role: currentLead.staticRole });
          }
        }
      }
    }
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private setLeadBorManager({ data, source }: any) {
    if (source.type === 'admin' && this.inst.name === source.name) {
      const targetAtt = this.inst.model.attendeesIndex[data.attendeeId];
      const targetRoom = this.inst.model.roomsIndex[data.borId];

      if (!targetAtt) {
        this.demoteOldLead(null, targetRoom, targetRoom.id);
        this.makeOfflineAttendeeLead(data, targetRoom);
        return;
      }

      if (data.makeLead) {
        this.demoteOldLead(null, targetRoom, targetAtt.room);
        this.inst.roomEngine.updateRoom(targetRoom.id, { assignedLeadId: data.attendeeId });
      } else {
        this.inst.roomEngine.updateRoom(targetRoom.id, { assignedLeadId: '' });
      }

      const newRole = data.makeLead ? Roles.LEAD : Roles.ATTENDEE;
      this.setRole(null, newRole, targetAtt, targetRoom);
    }
  }

  private makeOfflineAttendeeLead(data, targetRoom) {
    if (data.makeLead) {
      const currentLead = this.inst.model.attendeesIndex[targetRoom.currentLeadId];
      this.inst.roomEngine.updateRoom(targetRoom.id, { currentLeadId: data.attendeeId });
      if (currentLead) {
        this.inst.updateEngine.updateAttendee(null, currentLead.id, { role: currentLead.staticRole });
      }
    } else if (data.attendeeId === targetRoom.currentLeadId) {
      this.inst.roomEngine.updateRoom(targetRoom.id, { currentLeadId: '' });
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onChangeRole(client, data) {
    const target = this.inst.model.attendeesIndex[data.id];
    const sender = this.inst.model.attendeesIndex[client.data.aid];

    if (!target || !sender || sender.left || target.left || target.role === Roles.PHONE) {
      return;
    }

    const senderRoom = this.inst.model.roomsIndex[sender.room];
    const targetRoom = this.inst.model.roomsIndex[target.room];

    if (sender.role === Roles.LEAD && data.newRole !== Roles.LEAD) {
      return;
    }

    if (data.newRole === Roles.LEAD &&
      (target.role === Roles.COHOST || target.role === Roles.HOST || target.room === '' || targetRoom.isTestRoom)) {
      return;
    }

    if (!this.canAssignRole(sender, target, senderRoom, targetRoom)) {
      return;
    }

    if (data.newRole === Roles.LEAD) {
      this.demoteOldLead(client, targetRoom, target.room);
    }

    this.setRole(client, data.newRole, target, targetRoom);
  }

  @ApmSpan()
  private setRole(client, newRole, targetAttendee, targetRoom) {
    // in  case we try to assign the lead role to a co-host,
    // the co-host should remain with his role, but the old lead should lose his lead role
    if (targetAttendee.role === Roles.COHOST && newRole === Roles.LEAD) {
      this.inst.roomEngine.updateRoom(targetRoom.id, { currentLeadId: '' });
      return;
    }

    // demote the current lead to an attendee and set room.leadId to new lead
    if (newRole === Roles.LEAD) {
      this.inst.roomEngine.updateRoom(targetRoom.id, { currentLeadId: targetAttendee.id });
    } else if (targetRoom.currentLeadId === targetAttendee.id) {
      if (targetAttendee.id === targetRoom.assignedLeadId) {
        this.inst.roomEngine.updateRoom(targetRoom.id, { currentLeadId: '' });
      } else {
        const assignedLead = this.inst.model.attendeesIndex[targetRoom.assignedLeadId];
        if (assignedLead && assignedLead.room === targetRoom.id) {
          this.inst.updateEngine.updateAttendee(client, assignedLead.id, { role: Roles.LEAD });
        }
        this.inst.roomEngine.updateRoom(targetRoom.id, { currentLeadId: targetRoom.assignedLeadId });
      }
    }

    if (targetAttendee.room === targetRoom.id) {
      this.inst.updateEngine.updateAttendee(client, targetAttendee.id, { role: newRole });
    }
  }

  private canAssignRole(sender: Attendee, target: Attendee, senderRoom: Room, targetRoom: Room): boolean {
    // either the sender is COHOST or HOST in which case he is allowed to change roles
    // or the current lead in the BOR is passing his role to someone else
    return sender.role === Roles.COHOST || sender.role === Roles.HOST ||
      (
        sender.role === Roles.LEAD &&
        senderRoom.id === targetRoom.id
      );
  }

  private demoteOldLead(client, room: Room, newLeadRoom: string): void {
    const oldLead = this.inst.model.attendeesIndex[room.currentLeadId || room.assignedLeadId];
    if (oldLead && oldLead.role === Roles.LEAD &&
      (oldLead.room === newLeadRoom || oldLead.room === room.id)) {
      this.inst.roomEngine.updateRoom(room.id, { currentLeadId: '' });
      this.inst.updateEngine.updateAttendee(client, oldLead.id, { role: oldLead.staticRole });
    }
  }

  @Post(ServerRestAPI.KICK_OUT_ATTENDEES, [JwtSubjects.LEGACY_BACKEND])
  @ApmTransaction(TransactionType.REQUEST)
  private onKickAttendeesFromSession(@dRes res: ServerResponse,
    { kickedOutAttendeeIds }: { kickedOutAttendeeIds: Attendee['id'][] }
  ) {
    if (kickedOutAttendeeIds?.length < 1) {
      return res.end(400);
    }
    res.send(200, 'Ok');

    const kickReason = 'You have been removed from Session invitation list';
    kickedOutAttendeeIds.forEach((id) => {
      const attendee = this.inst.model.attendeesIndex[id];
      if (attendee && !attendee.left) {
        this.onKickout(null, attendee, kickReason);
      }
    });
  }

  @Socket(ServerConnectionAPI.SET_ATT_MEDIA_CONN_STRENGTH)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private setAttendeeMediaConnStrength(@dClient client: Client, data: {mediaConnStrength: MediaConnStrength}) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      return;
    }

    this.inst.updateEngine.updateAttendee(client, attendee.id, data, true);
  }

  private createKafkaRoomCheckEvent(
    eventName: string,
    attendee: Attendee,
    checkType: string,
    targetAttendeesCount?: number,
    roomId?: string
  ): ActiveMeetingEvent {
    const payload: ActiveMeetingEventPayload = {
      _id: uuid(),
      ts: Date.now(),
      meeting: KafkaUtils.getMeetingCommonData(this.inst.model),
      attendee: attendee ? KafkaUtils.getAttendeePropertiesForKafka(attendee) : null,
      roomCheck: {checkType, targetAttendeesCount, roomId}
    };
    return new ActiveMeetingEvent(eventName, payload);
  }

  private createKafkaRoomCheckKickoutEvent(
    attendee: Attendee,
    checkType: string,
    reason: string,
    isBanned: boolean = false
  ): ActiveMeetingEvent {
    const payload: ActiveMeetingEventPayload = {
      _id: uuid(),
      ts: Date.now(),
      meeting: KafkaUtils.getMeetingPropertiesForKafka(this.inst.model),
      attendee: KafkaUtils.getAttendeePropertiesForKafka(attendee),
      roomCheck: {checkType, reason, isBanned}
    };
    return new ActiveMeetingEvent('RoomCheckKickout', payload);
  }

  @Socket(ServerConnectionAPI.BLOCK_WHITEBOARD_ROOM)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private blockGroupWhiteboardRoom(@dClient client: Client, data) {
    this.blockWhiteboardRoom(client, data, WhiteboardType.GROUP);
  }

  @Socket(ServerConnectionAPI.BLOCK_ANNOTATIONS_ROOM)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private blockAnnotationsRoom(@dClient client: Client, data) {
    this.blockWhiteboardRoom(client, data, WhiteboardType.ANNOTATION);
  }

  @Socket(ServerConnectionAPI.BLOCK_WHITEBOARD)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private blockGroupWhiteboard(@dClient client: Client, data) {
    this.blockWhiteboard(client, data, WhiteboardType.GROUP);
  }

  @Socket(ServerConnectionAPI.BLOCK_ANNOTATIONS)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private blockAnnotations(@dClient client: Client, data) {
    this.blockWhiteboard(client, data, WhiteboardType.ANNOTATION);
  }

  @ApmTransaction(TransactionType.WS_REQUEST, {functionalDomain: FunctionalDomainType.WHITEBOARD})
  private async blockWhiteboardRoom(client, data, wbType: WhiteboardType) {
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const room: Room = this.inst.model.roomsIndex[sender.room];
    if (!room || !sender) {
      return;
    }
    const blockProperty: string = wbType === (WhiteboardType.ANNOTATION) ? 'lockAnnotations' : 'lockWhiteboard';

    if (sender.room === '' && !this.inst.roomEngine.isRoomPresenter(sender, '') ||
      (sender.room !== '' &&
        (!this.inst.roomEngine.isHost(sender) && !this.inst.roomEngine.isCoHost(sender) && !this.inst.roomEngine.isLead(sender)))) {
      // only Host and Co-Host can block WB from main room.
      // Lead in BOR can block group WB for room
      // Host in BOR can block only group WB for the room
      return;
    }

    // we need to clear all attendees that have individual settings for this
    const attendeesPackages: UpdateMessageData[] = [];
    const attendees = this.inst.attendeeStorage.getAttendeeMapByRoomId(room.id);

    for (const [_, attendee] of attendees) {
      if (attendee[blockProperty] !== null) {
        attendeesPackages.push({id: attendee.id, data: {[blockProperty]: null}});
      }
    }

    if (attendeesPackages.length) {
      await this.inst.updateEngine.updateAttendees(client, attendeesPackages);
    }

    this.inst.roomEngine.updateRoom(room.id, {[blockProperty]: data.blocked});
  }

  @ApmTransaction(TransactionType.WS_REQUEST, {functionalDomain: FunctionalDomainType.WHITEBOARD})
  private blockWhiteboard(client, data, wbType: WhiteboardType) {
    const attendee: Attendee = this.inst.model.attendeesIndex[data.id];
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const blockProperty: string = (wbType === WhiteboardType.ANNOTATION) ? 'lockAnnotations' : 'lockWhiteboard';

    if (!attendee || !sender) {
      return;
    }

    if (this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      this.inst.logger.debug('Unexpected Action in WhiteboardModule for Test Room.');
      return;
    }

    if (this.inst.roomEngine.isRoomPresenter(attendee, '') ||
      (attendee.room !== '' && this.inst.roomEngine.isRoomPresenter(attendee, attendee.room))) {
      // can not blocked whiteboard for the host and the current room presenter (in BOR)
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(sender, sender.room)) {
      // can not block whiteboard if have no rights
      return;
    }

    if (this.inst.roomEngine.isLead(sender) && sender.room !== attendee.room) {
      // lead can lock/unlock whiteboard only in the same room
      return;
    }

    this.inst.updateEngine.updateAttendee(client, attendee.id, {[blockProperty]: data.blocked});
  }
}
