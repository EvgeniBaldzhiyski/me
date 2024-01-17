import BaseModule from '../BaseModule';
import Meeting from '../../Meeting';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { ApmTransaction, TransactionType } from '@container/apm-utils';
import Client from '../../../../utils/Client';
import { client } from '../../../../gateway/decorators/argument.decorator';
import {
  Attendee,
  ChatMessage,
  ClientConnectionAPI,
  ServerConnectionAPI,
  DirectChatHistoryItem
} from '@container/models';
import { process, State } from '@progress/kendo-data-query';
import { fromEvent, merge } from 'rxjs';
import { takeUntil, tap } from 'rxjs/operators';

export enum ChatEvents {
  MESSAGE_ADDED = 'MESSAGE_ADDED',
  MESSAGE_DELETED = 'MESSAGE_DELETED',
  MESSAGE_EDITED = 'MESSAGE_EDITED',
  DELETE_ALL_MESSAGES = 'DELETE_ALL_MESSAGES'
}

export default class DirectChatHistoryModule extends BaseModule {
  // caches only the direct messages
  private cachedChats: DirectChatHistoryItem[] = [];
  // subscribed users for live update
  private directChatHistoryListeners: Set<Attendee['id']> = new Set();

  constructor(protected inst: Meeting) {
    super(inst);
    if (this.inst.model.sessionSettings.directChatsHistoryEnabled) {
      this.bindEvents();
    }
  }

  private bindEvents() {
    merge(
      fromEvent(this.inst.eventBus, ChatEvents.MESSAGE_ADDED).pipe(
        tap((message: ChatMessage) => this.addDirectChatMessage(message))
      ),
      fromEvent(this.inst.eventBus, ChatEvents.MESSAGE_EDITED).pipe(
        tap((message: ChatMessage) => this.updateDirectChatMessage(message))
      ),
      fromEvent(this.inst.eventBus, ChatEvents.MESSAGE_DELETED).pipe(
        tap((message: ChatMessage) => this.deleteDirectChatMessage(message))
      ),
      fromEvent(this.inst.eventBus, ChatEvents.DELETE_ALL_MESSAGES).pipe(
        tap((message: ChatMessage) => this.deleteAllDirectChatMessages(message))
      ),
    ).pipe(
      takeUntil(this.destroyed$)
    ).subscribe();
  }

  @Socket(ServerConnectionAPI.SET_DIRECT_CHAT_LIVERELOAD_STATE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private setLiveReloadState(@client client: Client, state: {enabled: boolean}) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!this.canAccessDirectChatHistory(attendee)) {
      return;
    }

    if (state.enabled) {
      this.directChatHistoryListeners.add(client.data.aid);
      return;
    }

    this.directChatHistoryListeners.delete(client.data.aid);
  }

  @Socket(ServerConnectionAPI.GET_DIRECT_CHAT_HISTORY_MESSAGES)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private getDirectChatMessages(@client client: Client, query: State) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!this.canAccessDirectChatHistory(attendee)) {
      return;
    }

    const result = process(this.cachedChats, query);

    this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.GET_DIRECT_CHAT_HISTORY_MESSAGES, result);
  }

  private addDirectChatMessage(message: ChatMessage) {
    const directChatHistoryMessage = this.mapToDirectChatHistoryItem(message);

    this.cachedChats.push(directChatHistoryMessage);

    this.inst.sendToAttendees(
      [...this.directChatHistoryListeners],
      ClientConnectionAPI.ADD_DIRECT_CHAT_HISTORY_MESSAGE,
      directChatHistoryMessage
    );
  }

  private updateDirectChatMessage(message: ChatMessage) {
    const msgIndex = this.cachedChats.findIndex(m => m.id === message.id);

    if (msgIndex === -1) {
      return;
    }

    this.cachedChats[msgIndex].text = message['post'];


    this.inst.sendToAttendees(
      [...this.directChatHistoryListeners],
      ClientConnectionAPI.UPDATE_DIRECT_CHAT_HISTORY_MESSAGE,
      this.cachedChats[msgIndex]
    );
  }

  private deleteDirectChatMessage(message: ChatMessage) {
    let directChatHistoryMessage = this.cachedChats.find(m => m.id === message.id);
    if (!directChatHistoryMessage) {
      return;
    }

    this.cachedChats = this.cachedChats.filter(m => m.id !== message.id);

    directChatHistoryMessage = {
      ...directChatHistoryMessage,
      isDeleted: true
    };

    this.inst.sendToAttendees(
      [...this.directChatHistoryListeners],
      ClientConnectionAPI.DELETE_DIRECT_CHAT_HISTORY_MESSAGE,
      directChatHistoryMessage
    );
  }

  private deleteAllDirectChatMessages(message: ChatMessage) {
    this.cachedChats = this.cachedChats.filter(m =>
      (m.recipientId !== message.recipientId || m.senderId !== message.senderId) &&
      (m.senderId !== message.recipientId || m.recipientId !== message.senderId));

    this.inst.sendToAttendees(
      [...this.directChatHistoryListeners],
      ClientConnectionAPI.DELETE_ALL_DIRECT_CHAT_HISTORY_MESSAGES,
      message
    );
  }

  private mapToDirectChatHistoryItem(message: ChatMessage): DirectChatHistoryItem {
    const senderFullName = `${message.senderFirstName} ${message.senderLastName}`;
    const receivingAttendee = this.inst.attendeeStorage.getAttendeeByUserAccountId(message.recipientId);
    const receiverFullName = `${receivingAttendee.firstName} ${receivingAttendee.lastName}`;

    return {
      ...message,
      senderFullName,
      receiverFullName,
    };
  }

  private canAccessDirectChatHistory(attendee: Attendee) {
    return this.inst.roomEngine.isHost(attendee) || this.inst.roomEngine.isCoHost(attendee);
  }
}
