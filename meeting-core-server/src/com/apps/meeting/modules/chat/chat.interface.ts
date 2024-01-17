import {
  Attendee,
  ChatMessage,
  ChatMessageData,
  MeetingMessageHistoryModel,
  MeetingMessagePersonalHistoryModel,
  Model,
  Room
} from '@container/models';
import { AxiosObservable } from 'axios-observable/dist/axios-observable.interface';
import { Observable } from 'rxjs';

export interface ChatInterface {
    getPersonalChatMessages(
      meetingID: Model['meetingID'],
      senderUserAccountID: Attendee['userAccountID'],
      recipientUserAccountID: Attendee['userAccountID']
    ): Observable<ChatMessage[]>;

    postPersonalChatMessage(
      meetingID: Model['meetingID'],
      { id, post, from, to }: ChatMessageData
    ): AxiosObservable<void>;

    editPersonalChatMessage(meetingID: Model['meetingID'], chatData): AxiosObservable<void>;

    deletePersonalChatMessage(meetingID: Model['meetingID'], chatData: ChatMessageData): AxiosObservable<void>;

    deleteAllPersonalChatMessages(
      meetingID: Model['meetingID'],
      senderUserAccountID: string,
      recipientUserAccountID: string
    ): AxiosObservable<void>;

    getGroupChatMessages(meetingID: Model['meetingID'], roomID: Room['id']): Observable<ChatMessage[]>;

    postGroupChatMessage(
      meetingID: Model['meetingID'],
      postId: string,
      post: string,
      from: Attendee['userAccountID'],
      to: Attendee['userAccountID']
    ): AxiosObservable<void>;

    editGroupChatMessage(meetingID: Model['meetingID'], chatId: string, chatData): AxiosObservable<void>;

    deleteGroupChatMessage(meetingID: Model['meetingID'], chatId: string, messageID: string): AxiosObservable<void>;

    deleteAllGroupChatMessages(
      meetingID: Model['meetingID'],
      chatId: string,
      senderUserAccountID
    ): AxiosObservable<void>;

    postBroadcastMessage(meetingID: Model['meetingID'], { post, from, rooms }: ChatMessageData): AxiosObservable<void>;

    getHistoryChatMessages(
      meetingID: Model['meetingID'],
      senderUserAccountID: Attendee['userAccountID']
    ): Observable<MeetingMessageHistoryModel[]>;

    getHistoryPersonalChatMessages(
      meetingID: Model['meetingID'],
      senderUserAccountID: Attendee['userAccountID'],
      recipientUserAccountID: Attendee['userAccountID']
    ): Observable<MeetingMessagePersonalHistoryModel[]>;
}
