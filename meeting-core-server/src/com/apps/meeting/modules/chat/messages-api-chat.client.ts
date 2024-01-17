import AxiosApiClientFacade from '../../../../utils/axios-api-client.facade';
import {
  Attendee,
  ChatMessage,
  UserAccountPersonalDataModel,
  ChatMessageData,
  MeetingMessageHistoryModel,
  MeetingMessagePersonalHistoryModel,
  Model,
  RestAPI,
  Room
} from '@container/models';
import { ApmSpan, FunctionalDomainType } from '@container/apm-utils';
import { AxiosObservable } from 'axios-observable/dist/axios-observable.interface';
import { Observable, throwError } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { ChatInterface } from './chat.interface';

/**
 * Stateless Axios Client for the Message API Gateway for the Chat Domain
 */
export class MessagesApiChatClient implements ChatInterface {
  private axiosApiMessagesFacade = new AxiosApiClientFacade('messages');
  private axiosApiCoreFacade = new AxiosApiClientFacade('core');

  constructor() {}

  //#region GROUP CHAT
  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  getGroupChatMessages(meetingID: Model['meetingID'],
                       roomID: Room['id']): Observable<ChatMessage[]> {
    return this.axiosApiMessagesFacade.client.get(
      `${ RestAPI.CHAT_GROUP }/meetings/${ meetingID }/rooms/${ roomID }`
    ).pipe(
      this.enrichMessagesWithUserDetails(),
      catchError(error => {
        return throwError(new Error(`Failed loading group chats. ${ error.message }`));
      })
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  postGroupChatMessage(meetingID: Model['meetingID'], postId: string, post: string, from: Attendee['userAccountID'], to: Attendee['userAccountID']): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.post(
      `${ RestAPI.CHAT_GROUP }/${ encodeURIComponent(to) }`,
      {
        id: postId,
        text: post,
        senderUserAccountID: from
      },
      {
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  editGroupChatMessage(meetingID: Model['meetingID'], roomID: string, chatData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.put(
      `${ RestAPI.CHAT_GROUP }/${ encodeURIComponent(roomID) }`,
      chatData,
      {
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  deleteGroupChatMessage(meetingID: Model['meetingID'], roomID: string, messageID: string): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.CHAT_GROUP }/${ encodeURIComponent(roomID) }`,
      {
        data: {
          id: messageID
        },
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  deleteAllGroupChatMessages(
    meetingID: Model['meetingID'],
    roomID: string,
    senderUserAccountID: Attendee['userAccountID']
  ): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.CHAT_GROUP }/${ encodeURIComponent(roomID) }`,
      {
        data: {
          isAll: true,
          senderUserAccountID
        },
        params: {
          meetingID
        }
      }
    );
  }
  //#endregion GROUP CHAT

  //#region PERSONAL CHAT
  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  getPersonalChatMessages(
    meetingID: Model['meetingID'],
   senderUserAccountID: Attendee['userAccountID'],
   recipientUserAccountID: Attendee['userAccountID']
  ): Observable<ChatMessage[]> {
    return this.axiosApiMessagesFacade.client.get(
      `${ RestAPI.CHAT_PERSONAL }/meetings/${ encodeURIComponent(meetingID) }/senders/${ encodeURIComponent(senderUserAccountID) }/recipients/${ encodeURIComponent(recipientUserAccountID) }`
    ).pipe(
      this.enrichMessagesWithUserDetails(),
      catchError(error => {
        return throwError(new Error(`Failed loading personal chats. ${ error.message }`));
      })
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  getHistoryChatMessages(meetingID: Model['meetingID'],
                        senderUserAccountID: Attendee['userAccountID']): Observable<MeetingMessageHistoryModel[]> {
    return this.axiosApiMessagesFacade.client.get(
      `${ RestAPI.CHAT_HISTORY }/${ encodeURIComponent(senderUserAccountID) }`,
      {
        params: {
          meetingID
        }
      }
    ).pipe(
      switchMap((responseMessages: any) => {
        const messages = responseMessages.data.privateChatHistories || {};
        const userIdsDistinct = messages.map(m => m.userAccountID).filter((user, index, arr) => arr.indexOf(user) == index);
        return this.axiosApiCoreFacade.client
          .post(RestAPI.POST_ACCOUNT_PERSONAL_DATA, { userIds: userIdsDistinct, pageNumber: 1, itemsPerPage: 999 })
          .pipe(map((responseUsers: any) => this.reMapHistoryMessage(messages, responseUsers.data.users || {}))
        );
      }),
      catchError(error => {
        return throwError(new Error(`Failed loading history chats. ${ error.message }`));
      })
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  getHistoryPersonalChatMessages(meetingID: Model['meetingID'],
                                senderUserAccountID: Attendee['userAccountID'],
                                recipientUserAccountID: Attendee['userAccountID']): Observable<MeetingMessagePersonalHistoryModel[]> {
    return this.axiosApiMessagesFacade.client.get(
      `${ RestAPI.PERSONAL_CHAT_HISTORY }/${ encodeURIComponent(senderUserAccountID) }/${ encodeURIComponent(recipientUserAccountID) }`,
      {
        params: {
          meetingID
        }
      }
    ).pipe(
      switchMap((responseMessages: any) => {
        const messages = responseMessages.data.meetingMessages || {};
        const userIdsDistinct = messages.map(m => m.senderId).filter((user, index, arr) => arr.indexOf(user) == index);
        return this.axiosApiCoreFacade.client
          .post(RestAPI.POST_ACCOUNT_PERSONAL_DATA, { userIds: userIdsDistinct, pageNumber: 1, itemsPerPage: 999 })
          .pipe(map((responseUsers: any) => this.reMapHistoryPersonalMessage(messages, responseUsers.data.users || {}))
        );
      }),
      catchError(error => {
        return throwError(new Error(`Failed loading history personal chats. ${ error.message }`));
      })
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  postPersonalChatMessage(meetingID: Model['meetingID'], { id, post, from, to }: ChatMessageData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.post(
      `${ RestAPI.CHAT_PERSONAL }`,
      {
        id,
        text: post,
        senderUserAccountID: from,
        recipientUserAccountID: to
      },
      {
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  editPersonalChatMessage(meetingID: Model['meetingID'], chatData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.put(
      `${ RestAPI.CHAT_PERSONAL }`,
      chatData,
      {
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  deletePersonalChatMessage(meetingID: Model['meetingID'], chatData: ChatMessageData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.CHAT_PERSONAL }`,
      {
        data: {
          id: chatData.id,
          senderUserAccountID: chatData.from,
          recipientUserAccountID: chatData.to
        },
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  deleteAllPersonalChatMessages(
    meetingID: Model['meetingID'],
    senderUserAccountID: string,
    recipientUserAccountID: string
  ): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.CHAT_PERSONAL }`,
      {
        data: {
          isAll: true,
          senderUserAccountID,
          recipientUserAccountID
        },
        params: {
          meetingID
        }
      }
    );
  }
  //#endregion PERSONAL CHAT

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.CHAT })
  postBroadcastMessage(meetingID: Model['meetingID'], { post, from, rooms }: ChatMessageData): AxiosObservable<void> {
    const url = `${ RestAPI.CHAT_BROADCAST }/${ encodeURIComponent(meetingID) }/sender/${ encodeURIComponent(from) }/broadcast`;
    return this.axiosApiMessagesFacade.client.post(
      url,
      {
        text: post,
        recipients: rooms
      }
    );
  }

  //#region PRIVATE METHODS
  private enrichMessagesWithUserDetails() {
    return switchMap((responseMessages: any) => {
      const messages = responseMessages.data.meetingMessages || {};
      const userIdsDistinct = messages.map(m => m.senderId).filter((user, index, arr) => arr.indexOf(user) == index);
      return this.axiosApiCoreFacade.client
        .post(RestAPI.POST_ACCOUNT_PERSONAL_DATA, { userIds: userIdsDistinct, pageNumber: 1, itemsPerPage: 999 })
        .pipe(
          map((responseUsers: any) => this.reMapMessage(messages, responseUsers.data.users || {}))
        );
    });
  }

  private reMapMessage(messages: ChatMessage[], users: UserAccountPersonalDataModel[]): ChatMessage[] {
    return messages.map(message => {
      const sender: UserAccountPersonalDataModel = users.find(x => x.userID === message.senderId);
      return {
        ...message,
        senderFirstName: sender  === undefined ? '' : sender.firstName,
        senderLastName: sender  === undefined ? '' : sender.lastName
      } as ChatMessage;
    });
  }

  private reMapHistoryMessage(messages: MeetingMessageHistoryModel[], users: UserAccountPersonalDataModel[]): MeetingMessageHistoryModel[] {
    return messages.map(message => {
      const sender: UserAccountPersonalDataModel = users.find(x => x.userID === message.userAccountID);
      return {
        ...message,
        fullUserAccountName: sender  === undefined ? '' : sender.fullName
      } as MeetingMessageHistoryModel;
    });
  }

  private reMapHistoryPersonalMessage(
    messages: MeetingMessagePersonalHistoryModel[],
    users: UserAccountPersonalDataModel[]
  ): MeetingMessagePersonalHistoryModel[] {
    return messages.map(message => {
      const sender: UserAccountPersonalDataModel = users.find(x => x.userID === message.senderId);
      return {
        ...message,
        senderFullName: sender  === undefined ? '' : sender.fullName
      } as MeetingMessagePersonalHistoryModel;
    });
  }
  //#endregion
}
