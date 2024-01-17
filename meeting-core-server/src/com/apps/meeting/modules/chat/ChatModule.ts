import apm from 'elastic-apm-node/start';
import v4 from 'uuid/v4';
import { ApmSpan, ApmTransaction, TransactionType, FunctionalDomainType } from '@container/apm-utils';
import BaseModule from './../BaseModule';
import Meeting from '../../Meeting';
import Client from '../../../../utils/Client';
import {
  Attendee,
  ChatMessage,
  ChatMessageData,
  ChatTypingData,
  ClientConnectionAPI,
  Roles,
  Room,
  ServerConnectionAPI,
  UpdateMessageData,
  MeetingMessageHistoryModel,
  MeetingMessagePersonalHistoryModel
} from '@container/models';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import { ChatEvents } from './DirectChatHistoryModule';
import { AttendeeFirstJoinSuccessEvent, AttendeeLeftAfterKickOut, AttendeeLeftAfterTimeoutEvent } from '../../events/SessionEvents';
import { EMPTY, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, finalize, map, sampleTime, switchMap, takeUntil, takeWhile, tap, filter, take } from 'rxjs/operators';
import { MessagesApiChatClient } from './messages-api-chat.client';
import config from 'config';
import { ChatInterface } from './chat.interface';
import { AttendeeCommonData, ChatEvent, ChatEventPayload } from '../../kafka/fa-event-types';
import { publishKafkaEvent } from '../../../../utils/kafka-publisher';
import KafkaUtils from '../../kafka/kafka-utils';

interface ChatTransportData {
  to: Attendee['id'] | Room['id'] | '*';
  from: Attendee['id'];
  post: string;
}

export default class ChatModule extends BaseModule {
  private typingMap: Map<string, ChatTypingData> = new Map();
  private sendWhoIsTypingTrigger$ = new Subject<undefined>();

  private testRoomLogMessage = 'Unexpected Action in ChatModule for Test Room.';

  // caches only the group chats
  private cachedChats: Map<string, ChatMessage[]> = new Map<string, ChatMessage[]>();

  private fetchLayoutInProgress = new Set<{ senderUserAccountID, recipientUserAccountID }>();
  private personalChatHistoryLoaded = new Subject<{ senderUserAccountID, recipientUserAccountID }>();

  private fetchChatHistoryInProgress = new Set<{ userAccountID }>();
  private chatHistoryLoaded = new Subject<{ userAccountID }>();

  protected messagesApiClient: ChatInterface;

  private loadChatSubscriptions = new Map<Attendee['id'], Subscription>();
  private loadGroupChat: Map<Room['id'],
    Observable<{rid: Room['id'], messages: ChatMessage[]}>
  > = new Map();
  private loadPersonalChat: Map<Attendee['userAccountID'],
    Observable<{from: Attendee['userAccountID'], to: Attendee['userAccountID'], messages: ChatMessage[]}>
  > = new Map();

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);

    this.sendWhoIsTypingSubscribe();

    this.messagesApiClient = new MessagesApiChatClient();

    if (this.inst.model.sessionSettings.enableChatNotifications) {
      this.inst.eventBus.on(AttendeeFirstJoinSuccessEvent.type, attendee => this.onAttendeeJoin(attendee));
      this.inst.eventBus.on(AttendeeLeftAfterTimeoutEvent.type, attendee => this.onAttendeeLeft(attendee));
      this.inst.eventBus.on(AttendeeLeftAfterKickOut.type, attendee => this.onAttendeeLeft(attendee));
    }
  }

  async destruct() {
    this.destroyed$.next();
    this.destroyed$.complete();
    return super.destruct();
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  approveAttendeeChange(_, id, data, done) {
    if (data.hasOwnProperty('room')) {
      const attendee = this.inst.model.attendeesIndex[id];

      // we need to remove individual settings when move between rooms - #482
      if (attendee.isGroupChatBlocked !== null) {
        data.isGroupChatBlocked = null;
      }

      if (attendee.isPersonalChatBlocked !== null) {
        data.isPersonalChatBlocked = null;
      }
    }

    done(data);
  }

  @Socket(ServerConnectionAPI.CHAT_LOAD_GROUP)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private onLoadGroupChatMessages(@client client: Client, target: Room['id']) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      return;
    }

    apm.setLabel('chatName', target);

    if (this.cachedChats.has(target)) {
      const messages = this.normalizeMessageList(this.cachedChats.get(target) || []);

      this.inst.server.sendTo(ClientConnectionAPI.CHAT_LOAD_GROUP, messages, client.id);
      return;
    }

    this.loadChatSubscriptions.get(client.data.aid)?.unsubscribe();
    this.loadChatSubscriptions.set(client.data.aid,
      this.loadGroupChatMessages(target).subscribe(({messages}) => {
        this.inst.server.sendTo(ClientConnectionAPI.CHAT_LOAD_GROUP, this.normalizeMessageList(messages), client.id);
      })
    );
  }

  @Socket(ServerConnectionAPI.CHAT_LOAD_PERSONAL)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private onLoadPersonalChatMessages(@client client: Client, target: Attendee['userAccountID']) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      return;
    }

    apm.setLabel('chatName', `${attendee.userAccountID}<->${target}`);

    this.loadChatSubscriptions.get(client.data.aid)?.unsubscribe();
    this.loadChatSubscriptions.set(client.data.aid,
      this.loadPersonalChatMessages(attendee.userAccountID, target).subscribe(({messages}) => {
        this.inst.server.sendTo(ClientConnectionAPI.CHAT_LOAD_PERSONAL, this.normalizeMessageList(messages), client.id);
      })
    );
  }

  @Socket(ServerConnectionAPI.CHAT_MESSAGE)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private onChatMessage(@client client: Client, inputData: ChatTransportData) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    const sender = this.inst.model.attendeesIndex[client.data.aid];

    if (!sender) {
      logger.debug(`Client (${ client.data.aid }) is not attendee`);
      return;
    }

    if (!this.canSendMessage(sender, inputData.to)) {
      return;
    }

    const room = this.inst.model.roomsIndex[sender.room];

    if (
      room.id === '' && inputData.to === '' &&
      !this.inst.roomEngine.isMainRoomPresenter(sender) &&
      !this.inst.roomEngine.hasMainRoomPresenter()
    ) {
      return;
    }

    this.sendChatMessage(sender.id, inputData.to, inputData.post);
  }

  @Socket(ServerConnectionAPI.CHAT_LOAD_HISTORY)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private onLoadHistoryChatMessages(@client client: Client, userAccountID) {
    apm.setLabel('chatName', userAccountID);
    // keep the logger reference for later
    const logger = this.inst.logger;

    if (this.fetchChatHistoryInProgress.has(userAccountID)) {
      this.chatHistoryLoaded.pipe(
        filter(userID => userID === userAccountID),
        take(1)
      )
      .subscribe(messages => {
        void this.inst.server.sendTo(ClientConnectionAPI.CHAT_LOAD_HISTORY, messages, client.id);
      });

      return;
    }

    this.fetchChatHistoryInProgress.add(userAccountID);

    this.messagesApiClient.getHistoryChatMessages(this.inst.model.meetingID, userAccountID)
    .pipe(
      takeUntil(this.destroyed$),
      finalize(() => {
        this.fetchChatHistoryInProgress.delete(userAccountID);
      }),
      tap((messages: MeetingMessageHistoryModel[]) => {
          void this.inst.server.sendTo(ClientConnectionAPI.CHAT_LOAD_HISTORY, messages, client.id);

          this.chatHistoryLoaded.next(userAccountID);
        },
      ),
      catchError(error => {
        apm.captureError(error);
        logger.error('Can not get history chat messages from the DB!', error);
        return EMPTY;
      })
    ).subscribe();
  }

  @Socket(ServerConnectionAPI.CHAT_LOAD_PERSONAL_HISTORY)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private onLoadPersonalHistoryChatMessages(@client client: Client, { senderUserAccountID, recipientUserAccountID }) {
    apm.setLabel('chatName', senderUserAccountID);
    // keep the logger reference for later
    const logger = this.inst.logger;

    if (this.fetchLayoutInProgress.has({ senderUserAccountID, recipientUserAccountID })) {
      this.personalChatHistoryLoaded.pipe(
        filter(x => x.senderUserAccountID === senderUserAccountID && x.recipientUserAccountID === recipientUserAccountID),
        take(1)
      )
      .subscribe(messages => {
        void this.inst.server.sendTo(ClientConnectionAPI.CHAT_LOAD_PERSONAL_HISTORY, messages, client.id);
      });

      return;
    }

    this.fetchLayoutInProgress.add({ senderUserAccountID, recipientUserAccountID });

    this.messagesApiClient.getHistoryPersonalChatMessages(this.inst.model.meetingID, senderUserAccountID, recipientUserAccountID)
    .pipe(
      takeUntil(this.destroyed$),
      finalize(() => {
        this.fetchLayoutInProgress.delete({ senderUserAccountID, recipientUserAccountID });
      }),
      tap((messages: MeetingMessagePersonalHistoryModel[]) => {
          void this.inst.server.sendTo(ClientConnectionAPI.CHAT_LOAD_PERSONAL_HISTORY, messages, client.id);

          this.personalChatHistoryLoaded.next({ senderUserAccountID, recipientUserAccountID });
        },
      ),
      catchError(error => {
        apm.captureError(error);
        logger.error('Can not get personal history chat messages from the DB!', error);
        return EMPTY;
      })
    ).subscribe();
  }

  @Socket(ServerConnectionAPI.CHAT_DELETE_MESSAGE)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private onDeleteChatMessage(@client client: Client, data: ChatMessageData) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!this.canDeleteMessage(attendee, data)) {
      return;
    }

    if (this.inst.model.roomsIndex[data.to]) {
      this.deleteGroupChatMessage(data).subscribe();
      this.inst.roomEngine.sendToRoom(data.to, ClientConnectionAPI.CHAT_DELETE_MESSAGE, data, true);
    } else {
      this.deletePersonalChatMessage(data).subscribe();

      const sendTo = new Set<Attendee['id']>();

      sendTo.add(this.inst.attendeeStorage.getAttendeeByUserAccountId(data.to)?.id);
      sendTo.add(this.inst.attendeeStorage.getAttendeeByUserAccountId(data.from)?.id);

      // in case requester is not from peers. Use case: host open some personal (between 2 peers) chat and moderate it.
      sendTo.add(attendee.id);

      this.inst.sendToAttendees(Array.from(sendTo), ClientConnectionAPI.CHAT_DELETE_MESSAGE, data);
    }
    this.emitEvent(ChatEvents.MESSAGE_DELETED, data);
  }

  @Socket(ServerConnectionAPI.CHAT_EDIT_MESSAGE)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  public onEditChatMessage(@client client: Client, data: ChatMessageData) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    /* === Server side check for rights of the "edit" action === */
    if (!this.canEditMessage(attendee, data)) {
      return;
    }

    if (this.inst.model.roomsIndex[data.to]) {
      this.editGroupChatMessage(data).subscribe();
      this.inst.roomEngine.sendToRoom(data.to, ClientConnectionAPI.CHAT_EDIT_MESSAGE, data, true);
    } else {
      this.editPersonalChatMessage(data).subscribe();

      const sendTo = [
        this.inst.attendeeStorage.getAttendeeByUserAccountId(data.to)?.id,
        this.inst.attendeeStorage.getAttendeeByUserAccountId(data.from)?.id
      ];

      if (attendee.userAccountID !== data.from) {
        sendTo.push(attendee.userAccountID);
      }

      this.inst.sendToAttendees(sendTo, ClientConnectionAPI.CHAT_EDIT_MESSAGE, data);
    }
    this.emitEvent(ChatEvents.MESSAGE_EDITED, data);
  }

  @Socket(ServerConnectionAPI.CHAT_DELETE_ALL)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private onChatDeleteAll(@client client: Client, to: Room['id'] | Attendee['userAccountID']) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    /* === Server side check for rights of the "delete" action === */
    if (!this.canDeleteAllMessages(attendee, to)) {
      return;
    }

    if (this.inst.model.roomsIndex[to]) {
      // room chat

      if (to !== '' && attendee.role !== Roles.HOST && attendee.role !== Roles.COHOST) {
        // in a BOR only the Host can change room settings - #481
        return;
      }

      this.deleteAllGroupChatMessages(to, attendee.userAccountID).subscribe();
    } else {
      // personal chat - we send only to the two participants
      this.deleteAllPersonalChatMessages(to, attendee.userAccountID).subscribe();

      this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.CHAT_DELETE_ALL, {to});
      this.inst.sendToAttendee(
        this.inst.attendeeStorage.getAttendeeByUserAccountId(to)?.id,
        ClientConnectionAPI.CHAT_DELETE_ALL,
        {to: attendee.userAccountID}
      );

      this.emitEvent(ChatEvents.DELETE_ALL_MESSAGES, {
        senderId: attendee.userAccountID,
        recipientId: to
      });
    }
  }

  @Socket(ServerConnectionAPI.BLOCK_GROUP_CHAT)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  public onBlockGroupChat(@client client: Client, data: { id: Attendee['id'], blocked: boolean }) {
    // keep the logger reference for later
    const logger = this.inst.logger;
    const attendee: Attendee = this.inst.model.attendeesIndex[data.id];
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee || !sender) {
      return;
    }

    if (this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      logger.debug(this.testRoomLogMessage);
      return;
    }

    if (this.inst.roomEngine.isMainRoomPresenter(attendee) || this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      // can not block chat for the host and the current presenter
      return;
    }

    if (!this.inst.roomEngine.isMainRoomPresenter(sender) && !this.inst.roomEngine.isRoomPresenter(sender, attendee.room)) {
      // only host and current presenter in the room can block chat
      return;
    }

    void this.inst.updateEngine.updateAttendee(client, attendee.id, { isGroupChatBlocked: data.blocked });
  }

  @Socket(ServerConnectionAPI.BLOCK_PERSONAL_CHAT)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  public onBlockPersonalChat(@client client: Client, data: { id: Attendee['userAccountID'], blocked: boolean }) {
    // keep the logger reference for later
    const logger = this.inst.logger;
    const attendee: Attendee = this.inst.attendeeStorage.getAttendeeByUserAccountId(data.id);
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee || !sender) {
      return;
    }

    if (this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      logger.debug(this.testRoomLogMessage);
      return;
    }

    if (this.inst.roomEngine.isMainRoomPresenter(attendee) || this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      // can not block chat for the host and the current presenter
      return;
    }

    if (!this.inst.roomEngine.isMainRoomPresenter(sender) && !this.inst.roomEngine.isRoomPresenter(sender, attendee.room)) {
      // only host and current presenter in the room can block chat
      return;
    }

    void this.inst.updateEngine.updateAttendee(client, attendee.id, { isPersonalChatBlocked: data.blocked });
  }

  @Socket(ServerConnectionAPI.BLOCK_GROUP_CHAT_ROOM)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  public onBlockGroupChatRoom(@client client: Client, data: { id: Room['id'], blocked: boolean }) {
    // keep the logger reference for later
    const logger = this.inst.logger;
    const room: Room = this.inst.model.roomsIndex[data.id];
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!room || !sender) {
      return;
    }

    if (room.isTestRoom) {
      logger.debug(this.testRoomLogMessage);
      return;
    }

    if (!this.inst.roomEngine.isMainRoomPresenter(sender) && !this.inst.roomEngine.isRoomPresenter(sender, room.id)) {
      // only host and current presenter in the room can block chat
      return;
    }

    // we need to clear all attendees that have individual setting for this
    const msgPacks = Object.values(this.inst.model.attendeesIndex).filter(
      attendee => attendee && attendee.room === room.id && attendee.isGroupChatBlocked !== null
    ).map(
      attendee => new UpdateMessageData(attendee.id, { isGroupChatBlocked: null })
    );

    if (msgPacks.length) {
      void this.inst.updateEngine.updateAttendees(null, msgPacks);
    }

    this.inst.roomEngine.updateRoom(room.id, { isGroupChatBlocked: data.blocked });
  }

  @Socket(ServerConnectionAPI.BLOCK_PERSONAL_CHAT_ROOM)
  @ApmTransaction(TransactionType.WS_REQUEST)
  public onBlockPersonalChatRoom(@client client: Client, data: { id: Room['id'], blocked: boolean }) {
    // keep the logger reference for later
    const logger = this.inst.logger;
    const room: Room = this.inst.model.roomsIndex[data.id];
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!room || !sender) {
      return;
    }

    if (room.isTestRoom) {
      logger.debug(this.testRoomLogMessage);
      return;
    }

    if (!this.inst.roomEngine.isMainRoomPresenter(sender) && !this.inst.roomEngine.isRoomPresenter(sender, room.id)) {
      // only host and current presenter in the room can block personal chat
      return;
    }

    // we need to clear all attendees that have individual setting for this
    const msgPacks = Object.values(this.inst.model.attendeesIndex).filter(
      attendee => attendee && attendee.room === room.id && attendee.isPersonalChatBlocked !== null
    ).map(
      attendee => new UpdateMessageData(attendee.id, { isPersonalChatBlocked: null })
    );

    if (msgPacks.length) {
      void this.inst.updateEngine.updateAttendees(null, msgPacks);
    }

    this.inst.roomEngine.updateRoom(room.id, { isPersonalChatBlocked: data.blocked });
  }

  // -- end public api

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private loadGroupChatMessages(rid: Room['id']): Observable<{rid: Room['id'], messages: ChatMessage[]}> {
    if (!this.loadGroupChat[rid]) {
      this.loadGroupChat.set(rid, this.messagesApiClient.getGroupChatMessages(this.inst.model.meetingID, rid).pipe(
        map(messages => {
          messages = messages.map(message => {
            if (message.senderId !== config.get('systemUserAccountId')) {
              return message;
            }

            return {...message, text: this.convertNamesInTag(message.text)};
          });

          this.cachedChats.set(rid, messages);

          return {rid, messages};
        }),
        takeUntil(this.destroyed$),
        finalize(() => {
          this.loadGroupChat.delete(rid);
        }),
        catchError(error => {
          apm.captureError(error);
          this.inst.logger.error(`Can not get group chat messages from the DB!. ${ error.message }`);

          return EMPTY;
        }),
      ));
    }

    return this.loadGroupChat.get(rid);
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private loadPersonalChatMessages(
    from: Attendee['userAccountID'],
    to: Attendee['userAccountID']
  ): Observable<{
    from: Attendee['userAccountID'],
    to: Attendee['userAccountID'],
    messages: ChatMessage[]
  }> {
    const key = `${from}${to}`;

    if (!this.loadPersonalChat[key]) {
      this.loadPersonalChat.set(key, this.messagesApiClient.getPersonalChatMessages(this.inst.model.meetingID, from, to).pipe(
        map(messages => {
          return {from, to, messages};
        }),
        takeUntil(this.destroyed$),
        finalize(() => this.loadPersonalChat.delete(key)),
        catchError(error => {
          apm.captureError(error);
          this.inst.logger.error('Can not get personal chat messages from the DB!', error);
          return EMPTY;
        }),
      ));
    }

    return this.loadPersonalChat.get(key);
  }

  private sendChatMessage(from: Attendee['id'], to: Attendee['id'] | Room['id'] | '*', post: string) {
    const sender = this.inst.model.attendeesIndex[from];
    if (!sender) {
      this.inst.logger.debug(`Client (${ from }) is not attendee`);
      return;
    }

    const workMessageData = new ChatMessageData(v4(), to, sender.userAccountID, post, Date.now(), to === '*');

    workMessageData.senderFirstName = sender.firstName;
    workMessageData.senderLastName = sender.lastName;

    if (to === '*') {
      this.broadcastMessage(workMessageData);

      if (sender.userAccountID !== config.get('systemUserAccountId')) {
        const kEvent = this.createKafkaChatEvent('BroadcastGroupMessage',
          workMessageData,
          Object.keys(this.inst.model.roomsIndex),
          KafkaUtils.createAttendeeCommonData(from, sender.userAccountID),
          null
        );
        publishKafkaEvent(kEvent, this.inst.model.meetingID);
      }
      return;
    }

    if (this.inst.model.roomsIndex[to]) {
      this.sendGroupChatMessage(to, workMessageData).subscribe();

      if (sender.userAccountID !== config.get('systemUserAccountId')) {
        const kEvent = this.createKafkaChatEvent('SendGroupMessage',
          workMessageData,
          [to],
          KafkaUtils.createAttendeeCommonData(from, sender.userAccountID),
          null
        );
        publishKafkaEvent(kEvent, this.inst.model.meetingID);
      }
      return;
    }

    const receiver = this.inst.model.attendeesIndex[to];
    if (!receiver) {
      this.inst.logger.debug(`Client (${ to }) is not attendee`);
      return;
    }

    workMessageData.to = receiver.userAccountID;

    // personal chat - we send only to the two participants
    this.sendPersonalChatMessageToDB(workMessageData).subscribe(() => {
      this.emitEvent(ChatEvents.MESSAGE_ADDED, {
        id: workMessageData.id,
        senderId: workMessageData.from,
        senderFirstName: workMessageData.senderFirstName,
        senderLastName: workMessageData.senderLastName,
        recipientId: workMessageData.to,
        timestamp: workMessageData.ts,
        text: workMessageData.post,
        isDeleted: false
      });

      const kEvent = this.createKafkaChatEvent('SendPersonalMessage',
        workMessageData,
        null,
        KafkaUtils.createAttendeeCommonData(from, sender.userAccountID),
        KafkaUtils.createAttendeeCommonData(to, receiver.userAccountID),
      );
      publishKafkaEvent(kEvent, this.inst.model.meetingID);
    });

    this.inst.sendToAttendees([receiver.id, sender.id], ClientConnectionAPI.CHAT_MESSAGE, workMessageData);
  }

  private canSendMessage(sender: Attendee, receiverId: Attendee['id']) {
    if (this.inst.roomEngine.isRoomPresenter(sender, '') || this.inst.roomEngine.isHost(sender)) {
      // host and main room presenter can always send messages
      return true;
    }

    if (this.inst.roomEngine.isRoomPresenter(sender, sender.room)) {
      // room presenter can always send messages
      return true;
    }

    const msgReceiver: Attendee = this.inst.model.attendeesIndex[receiverId];

    if (msgReceiver) {
      // personal message
      if (this.inst.roomEngine.isRoomPresenter(msgReceiver, '') || this.inst.roomEngine.isHost(msgReceiver)) {
        // host and main room presenter can always receive messages
        return true;
      }

      if (this.inst.roomEngine.isRoomPresenter(msgReceiver, msgReceiver.room)) {
        // room presenter can always receive messages
        return true;
      }

      if (msgReceiver.isPersonalChatBlocked === false && sender.isPersonalChatBlocked === false) {
        // NOTE: we check for false, null means something else for these properties
        // if the attendees have flags for allowed personal chat - they override the room values
        return true;
      }

      if (sender.room !== msgReceiver.room) {
        // the attendees should be in the same room to have personal chat between them
        return false;
      }

      if (msgReceiver.isPersonalChatBlocked || sender.isPersonalChatBlocked) {
        // personal chat is blocked for the sender or the receiver
        return false;
      }

      const attRoom: Room = this.inst.roomEngine.getRoomById(sender.room);

      if (attRoom.isPersonalChatBlocked) {
        // it is ok to check only one of the rooms, because above we check both attendees to be in the same room
        return false;
      }

      return true;
    }

    // group chat
    const roomReceiver: Room = this.inst.model.roomsIndex[receiverId];

    if (!roomReceiver) {
      return false;
    }

    if (sender.isGroupChatBlocked === false) {
      // NOTE: we check for false, null means something else for these properties
      // if the attendee have flags for allowed group chat - they override the room values
      return true;
    }

    if (sender.isGroupChatBlocked) {
      // If the group chat is personally blocked for the sender, do not proceed
      return false;
    }

    if (roomReceiver.isGroupChatBlocked) {
      // group chat is blocked for the receiving room or for the sender
      return false;
    }

    return true;
  }

  private canDeleteMessage(attendee: Attendee, data: ChatMessageData) {
    if (!attendee) {
      return false;
    }

    const msgOwner = this.inst.attendeeStorage.getAttendeeByUserAccountId(data.from);

    if (msgOwner?.userAccountID === config.get('systemUserAccountId')) {
      return false;
    }

    return (
      // (attendee.id === data.messageData.attendee.id) || // can delete own messages
      attendee.userAccountID === data.from || // can delete own messages
      // can delete other messages if main room presenter and message is not from host or co-host
      this.inst.roomEngine.isHost(attendee) || // if host can delete all messages
      this.inst.roomEngine.isCoHost(attendee) || // if co-host can delete all messages
      (
        msgOwner &&
        !this.inst.roomEngine.isHost(msgOwner) &&
        !this.inst.roomEngine.isCoHost(msgOwner) &&
        this.inst.roomEngine.isRoomPresenter(attendee, '')
      )
    );
  }

  private canDeleteAllMessages(attendee: Attendee, rid: Room['id']) {
    if (!attendee) {
      return false;
    }

    if (this.inst.roomEngine.isHost(attendee) || this.inst.roomEngine.isCoHost(attendee)) {
      // host and co-host can always delete messages
      return true;
    }

    if (this.inst.roomEngine.isRoomPresenter(attendee, rid)) {
      // current presenter in the group room chat can delete messages
      return true;
    }

    return false;
  }

  private canEditMessage(attendee: Attendee, data: ChatMessageData) {
    if (!attendee) {
      return false;
    }

    if (attendee.userAccountID === config.get('systemUserAccountId')) {
      return false;
    }

    return (attendee.userAccountID === data.from);
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private sendGroupChatMessage(to: Room['id'], data: ChatMessageData) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    const sender = this.inst.attendeeStorage.getAttendeeByUserAccountId(data.from);
    if (!sender) {
      logger.error(`sendChatMessageToDB message from unknown attendee with UserAccountId ${ data.from }`, data);
      apm.captureError(`sendChatMessageToDB message from unknown attendee with UserAccountId ${ data.from }`);
      return;
    }

    const cache = this.cachedChats.get(data.to);

    if (cache) {
      const messages = cache.concat([{
        id: data.id,
        senderId: sender.userAccountID,
        senderFirstName: sender.firstName,
        senderLastName: sender.lastName,
        recipientId: '',
        timestamp: data.ts,
        text: data.post,
        isDeleted: false
      }]);

      this.cachedChats.set(data.to, messages);
    }


    this.inst.roomEngine.sendToRoom(to, ClientConnectionAPI.CHAT_MESSAGE, data, true);

    let post = data.post;
    if (sender.id === config.get('systemUserAccountId')) {
      post = this.convertNamesInPlain(post);
    }

    return this.messagesApiClient.postGroupChatMessage(this.inst.model.meetingID, data.id, post, data.from, data.to).pipe(
      takeUntil(this.destroyed$),
      tap(
        () => {
          logger.debug('Chat message added');
        },
        (err) => {
          apm.captureError(err);
          logger.error('Can not send chat message to the DB!', err);
        }
      )
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private sendPersonalChatMessageToDB(data: ChatMessageData) {
    // keep for later usage as this.inst may be destroyed already when needed
    const logger = this.inst.logger;
    return this.messagesApiClient.postPersonalChatMessage(this.inst.model.meetingID, data).pipe(
      tap(
        () => {
          logger.debug('Chat message added');
        },
        (err) => {
          apm.captureError(err);
          logger.error('Can not send chat message to the DB!', err);
        }
      ),
      // ensure the request completes as otherwise risk data loss if canceled right away,
      // still don't continue down the pipe given the context (Meeting) may be gone already,
      // thus the result should not apply any more side effects
      // this is similar to `takeWhile(() => this.inst && this.inst.lifeCycleState < SHUTTING_DOWN)`
      // may be more portable through for usage
      takeWhile(() => !this.destroyed$?.isStopped)
      // tap and do some more stuff here if needed
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private editPersonalChatMessage(data: ChatMessageData) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    return of(data).pipe(
      map(data => {
        return {
          text: data.post,
          id: data.id,
          senderUserAccountID: this.inst.attendeeStorage.getAttendeeByUserAccountId(data.from).userAccountID,
          recipientUserAccountID: this.inst.attendeeStorage.getAttendeeByUserAccountId(data.to).userAccountID
        };
      }),
      switchMap(chatData => {
        return this.messagesApiClient.editPersonalChatMessage(this.inst.model.meetingID, chatData)
          .pipe(
            takeUntil(this.destroyed$),
            // ensure the request completes as otherwise risk data loss if canceled right away,
            // still don't continue down the pipe given the context (Meeting) may be gone already,
            // thus the result should not apply any more side effects
            // this is similar to `takeWhile(() => this.inst && this.inst.lifeCycleState < SHUTTING_DOWN)`
            // may be more portable through for usage
            takeWhile(() => !this.destroyed$?.isStopped),
            // tap and do some more stuff here if needed
            tap(result => {
              logger.debug('Chat message edited');
              if (!this.inst) {
                // the Meeting was destroyed probably while this request finish, that was too late
                logger.warn('Did not persist the chat message edit in the DB on time!');
                return;
              }
            }),
            catchError(error => {
              apm.captureError(error);
              logger.error(`Can not send edit chat message to the DB! ${ error.message }`);
              return EMPTY;
            })
          );
      })
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private editGroupChatMessage(data: ChatMessageData) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    this.cachedChats.set(data.to, (this.cachedChats.get(data.to) || []).map(msg => {
      if (msg.id === data.id) {
        msg.text = data.post;
      }

      return msg;
    }));


    return this.messagesApiClient.editGroupChatMessage(this.inst.model.meetingID, data.to, {
      text: data.post,
      id: data.id,
    })
      .pipe(
        takeUntil(this.destroyed$),
        // ensure the request completes as otherwise risk data loss if canceled right away,
        // still don't continue down the pipe given the context (Meeting) may be gone already,
        // thus the result should not apply any more side effects
        // this is similar to `takeWhile(() => this.inst && this.inst.lifeCycleState < SHUTTING_DOWN)`
        // may be more portable through for usage
        takeWhile(() => !this.destroyed$?.isStopped),
        // tap and do some more stuff here if needed
        tap(result => {
          logger.debug('Chat message edited');
          if (!this.inst) {
            // the Meeting was destroyed probably while this request finish, that was too late
            logger.warn('Did not persist the chat message edit in the DB on time!');
            return;
          }
        }),
        catchError(error => {
          apm.captureError(error);
          logger.error(`Can not send edit chat message to the DB! ${ error.message }`);
          return EMPTY;
        })
      );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private deletePersonalChatMessage(data: ChatMessageData) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    return this.messagesApiClient.deletePersonalChatMessage(this.inst.model.meetingID, data)
      .pipe(
        tap(() => {
          logger.debug('Chat message deleted');
          if (!this.inst) {
            // the Meeting was destroyed probably while this request finish, that was too late
            logger.warn('Did not delete the chat message from the DB on time!');
            return;
          }
        }),
        catchError(error => {
          apm.captureError(error);
          logger.error(`Can not send delete chat message to the DB! ${ error.message }`);
          return EMPTY;
        })
      );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private deleteAllPersonalChatMessages(to: Attendee['userAccountID'], from: Attendee['userAccountID']) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    return this.messagesApiClient.deleteAllPersonalChatMessages(this.inst.model.meetingID, from, to)
      .pipe(
        tap(() => {
          logger.debug('Chat message deleted');
          if (!this.inst) {
            // the Meeting was destroyed probably while this request finish, that was too late
            logger.warn('Did not delete the chat message from the DB on time!');
            return;
          }
        }),
        catchError(error => {
          apm.captureError(error);
          logger.error(`Can not send delete chat message to the DB! ${ error.message }`);
          return EMPTY;
        })
      );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private deleteGroupChatMessage(data: ChatMessageData) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    return this.messagesApiClient.deleteGroupChatMessage(this.inst.model.meetingID, data.to, data.id)
      .pipe(
        tap(() => {
          logger.debug('Chat message deleted');
          if (!this.inst) {
            // the Meeting was destroyed probably while this request finish, that was too late
            logger.warn('Did not delete the chat message from the DB on time!');
            return;
          }

          const messages = (this.cachedChats.get(data.to) || []);
          const index = messages.findIndex(m => m.id === data.id);
          if (index > -1) {
            messages.splice(index, 1);
            this.cachedChats.set(data.to, messages);
          }
        }),
        catchError(error => {
          apm.captureError(error);
          logger.error(`Can not send delete chat message to the DB! ${ error.message }`);
          return EMPTY;
        })
      );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private deleteAllGroupChatMessages(to: Room['id'], from: Attendee['userAccountID']) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    const list: ChatMessage[] = this.cachedChats.get(to) || [];

    if (to !== '' || !list.length) {
      this.cachedChats.delete(to);
      this.inst.roomEngine.sendToRoom(to, ClientConnectionAPI.CHAT_DELETE_ALL, {to}, true);
    } else {
      const filtered = list.filter(msg => msg.senderId === config.get('systemUserAccountId'));

      this.cachedChats.set(to, filtered);
      this.inst.roomEngine.sendToRoom(to, ClientConnectionAPI.CHAT_DELETE_ALL, {
        to,
        filter: this.normalizeMessageList(filtered)
      }, true);
    }

    return this.messagesApiClient.deleteAllGroupChatMessages(this.inst.model.meetingID, to, from).pipe(
      tap(() => {
        logger.debug('Chat messages deleted');
        if (!this.inst) {
          // the Meeting was destroyed probably while this request finish, that was too late
          logger.warn('Did not delete all the chat message from the DB on time!');
          return;
        }
      }),
      catchError(error => {
        apm.captureError(error);
        logger.error(`Can not send delete all chat messages from the DB! ${ error.message }`);
        return EMPTY;
      })
    );
  }

  @Socket(ServerConnectionAPI.CHAT_TYPING)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private onToggleTyping(@client client: Client, data: ChatTypingData) {
    const sender = this.inst.model.attendeesIndex[client.data.aid];

    if (!sender) {
      return;
    }

    const opposite = this.typingMap.get(data.sendFrom);

    if (opposite && opposite.isTyping !== data.isTyping) {
      this.typingMap.delete(data.sendFrom);
      return;
    }

    this.typingMap.set(data.sendFrom, data);

    this.sendWhoIsTypingTrigger$.next();
  }

  @ApmTransaction(TransactionType.RPC_REQUEST, { functionalDomain: FunctionalDomainType.CHAT })
  private sendWhoIsTyping() {
    const targetRooms: Map<string, ChatTypingData[]> = new Map();

    this.typingMap.forEach(({ sendTo, sendFrom, isTyping }) => {
      const attendee = this.inst.model.attendeesIndex[sendTo];

      if (attendee) {
        this.inst.sendToAttendee(sendTo, ClientConnectionAPI.CHAT_TYPING, [{ sendTo, sendFrom, isTyping }]);
        return;
      }

      const roomList = (targetRooms.get(sendTo) || []);
      roomList.push({ sendTo, sendFrom, isTyping });

      targetRooms.set(sendTo, roomList);
    });

    this.typingMap.clear();

    targetRooms.forEach((list, key) => {
      this.inst.roomEngine.sendToRoom(key, ClientConnectionAPI.CHAT_TYPING, list, true);
    });

    targetRooms.clear();
  }

  private sendWhoIsTypingSubscribe() {
    return this.sendWhoIsTypingTrigger$
      .pipe(
        takeUntil(this.destroyed$),
        sampleTime(3000)
      )
      .subscribe(() => {
        this.sendWhoIsTyping();
      });
  }

  // @FIXME revise whole broadcastMessage feature!!! send to web-app is mishmash, sync send to db and send to web-app is mishmash.
  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private broadcastMessage(message: ChatMessageData): void {
    const rooms = Object.keys(this.inst.model.roomsIndex).map(rid => {
      const uuid = v4();
      const returnData = {
        messageId: uuid, // generate new id so the message can be valid
        roomId: rid || null
      };

      const attendee = this.inst.attendeeStorage.getAttendeeByUserAccountId(message.from);
      // @fixme revise this case
      if (!attendee) {
        this.inst.logger.error(`sendBroadcastMessageToDB message from unknown attendee with UserAccountId ${ message.from }`, message);
        apm.captureError(`sendBroadcastMessageToDB message from unknown attendee with UserAccountId ${ message.from }`);

        return returnData;
      }

      // @fixme if the room is not visit yet load and cache messages first!
      const messages = (this.cachedChats.get(rid) || []).concat([{
        id: uuid,
        senderId: attendee.userAccountID,
        senderFirstName: attendee.firstName,
        senderLastName: attendee.lastName,
        recipientId: '',
        timestamp: message.ts,
        text: message.post,
        isDeleted: false
      }]);

      this.cachedChats.set(rid, messages);

      this.inst.roomEngine.sendToRoom(rid, ClientConnectionAPI.CHAT_MESSAGE, {...message, id: uuid, to: rid}, true);

      return returnData;
    });

    this.sendBroadcastMessageToDB({...message, rooms}).subscribe();
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  private sendBroadcastMessageToDB(data: ChatMessageData) {
    return this.messagesApiClient.postBroadcastMessage(this.inst.model.meetingID, data).pipe(
      takeUntil(this.destroyed$),
      tap(() => {
        this.inst.logger.debug('Chat message added');
      }),
      catchError(error => {
        apm.captureError(error);
        this.inst.logger.error('Can not send chat message to the DB!', error);
        return EMPTY;
      })
    );
  }

  private normalizeMessageList(messages: ChatMessage[]) {
    return messages.map(message => {
      return {
        id: message.id,
        to: message.recipientId,
        from: message.senderId,
        senderFirstName: message.senderFirstName,
        senderLastName: message.senderLastName,
        post: message.text,
        ts: message.timestamp,
      } as ChatMessageData;
    });
  }

  private emitEvent(event: ChatEvents, payload: ChatMessage | Partial<ChatMessage>) {
    this.inst.eventBus.emit(event, payload);
  }

  private onAttendeeJoin(attendee: Attendee) {
    if (attendee.role === Roles.GHOST) {
      return;
    }

    this.sendChatMessage(config.get('systemUserAccountId'), '', this.createSystemMessage(attendee.firstName, attendee.lastName, false));
  }

  private onAttendeeLeft(attendee: Attendee) {
    if (attendee.role === Roles.GHOST) {
      return;
    }

    this.sendChatMessage(config.get('systemUserAccountId'), '', this.createSystemMessage(attendee.firstName, attendee.lastName, true));
  }

  private createSystemMessage(firstname: Attendee['firstName'], lastname: Attendee['lastName'], isLeft: boolean) {
    return `${this.encodeSpecialNamesString(firstname, lastname)} has ${isLeft ? 'Left' : 'Entered'} the session.`;
  }

  private encodeSpecialNamesString(firstname: Attendee['firstName'], lastname: Attendee['lastName']) {
    return `@{{${firstname}_${lastname}}}`;
  }

  private convertNamesInPlain(message: string) {
    return message.replace(/@\{\{([^_]+)_([^\}]*)\}\}/, (_, firstname, lastname) => `${firstname} ${lastname}`);
  }

  private convertNamesInTag(message: string) {
    return message.replace(/^([^ ]+) ([^ ]+)/, (_, firstname, lastname) => this.encodeSpecialNamesString(firstname, lastname));
  }

  private createKafkaChatEvent(eventName: string,
    workMessageData: ChatMessageData,
    roomIds: string[] | null,
    sender: AttendeeCommonData,
    recipient: AttendeeCommonData | null
  ): ChatEvent {
    const payload: ChatEventPayload = {
      _id: workMessageData.id,
      ts: workMessageData.ts,
      isBroadcast: workMessageData.isBroadcast,
      roomIds: roomIds,
      sender: sender,
      recipient: recipient,
      meeting: KafkaUtils.getMeetingCommonData(this.inst.model)
    };

    return new ChatEvent(eventName, payload);
  }
}
