import AxiosApiClientFacade from '../../../../utils/axios-api-client.facade';
import { Attendee, MeetingNote, UserAccountPersonalDataModel, Model, RestAPI, Room } from '@container/models';
import { ApmSpan, FunctionalDomainType } from '@container/apm-utils';
import { AxiosObservable } from 'axios-observable/dist/axios-observable.interface';
import { Observable, throwError } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { NoteInterface  } from './note.interface';
import serverConfig from '../../../../utils/serverConfig';

/**
 * Stateless Axios Client for the Message API Gateway for the Chat Domain
 */
 export class MessagesApiNoteClient implements NoteInterface {
  private axiosApiMessagesFacade = new AxiosApiClientFacade('messages');
  private axiosApiCoreFacade = new AxiosApiClientFacade('core');

  //#region GROUP NOTE
  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  getGroupNoteMessages(
    meetingID: Model['meetingID'],
    senderUserAccountID: Attendee['userAccountID'],
    roomID: Room['id']
  ): Observable<MeetingNote[]> {
    return this.axiosApiMessagesFacade.client.get(
      `${ RestAPI.GROUP_NOTEBOARD }/meetings/${ encodeURIComponent(meetingID) }/senders/${ encodeURIComponent(senderUserAccountID) }/rooms/${ encodeURIComponent(roomID) }`
    ).pipe(
      this.enrichNotesWithUserDetails(),
      catchError(error => {
        return throwError(new Error(`Failed loading group notes. ${ error.message }`));
      })
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  postGroupNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.post(
      `${ RestAPI.GROUP_NOTEBOARD }`,
      noteData,
      {
        params: {
          meetingID
        },
        maxContentLength: serverConfig.CONFIG.axios.noteMaxContentLength,
        maxBodyLength: serverConfig.CONFIG.axios.noteMaxBodyLength
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  editGroupNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.put(
      `${ RestAPI.GROUP_NOTEBOARD }`,
      noteData,
      {
        params: {
          meetingID
        },
        maxContentLength: serverConfig.CONFIG.axios.noteMaxContentLength,
        maxBodyLength: serverConfig.CONFIG.axios.noteMaxBodyLength
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  deleteGroupNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.GROUP_NOTEBOARD }`,
      {
        data: noteData,
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  deleteAllGroupNoteMessages(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.GROUP_NOTEBOARD }`,
      {
        data: noteData,
        params: {
          meetingID
        }
      }
    );
  }
  //#endregion

  //#region PERSONAL NOTE
  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  getPersonalNoteMessages(
    meetingID: Model['meetingID'],
    senderUserAccountID: Attendee['userAccountID']
  ): Observable<MeetingNote[]> {
    return this.axiosApiMessagesFacade.client.get(
      `${ RestAPI.PERSONAL_NOTEBOARD }/meetings/${ encodeURIComponent(meetingID) }/senders/${ encodeURIComponent(senderUserAccountID) }`
    ).pipe(
      this.enrichNotesWithUserDetails(),
      catchError(error => {
        return throwError(new Error(`Failed loading personal notes. ${ error.message }`));
      })
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  postPersonalNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.post(
      `${ RestAPI.PERSONAL_NOTEBOARD }`,
      noteData,
      {
        params: {
          meetingID
        },
        maxContentLength: serverConfig.CONFIG.axios.noteMaxContentLength,
        maxBodyLength: serverConfig.CONFIG.axios.noteMaxBodyLength
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  editPersonalNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.put(
      `${ RestAPI.PERSONAL_NOTEBOARD }`,
      noteData,
      {
        params: {
          meetingID
        },
        maxContentLength: serverConfig.CONFIG.axios.noteMaxContentLength,
        maxBodyLength: serverConfig.CONFIG.axios.noteMaxBodyLength
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  deletePersonalNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.PERSONAL_NOTEBOARD }`,
      {
        data: noteData,
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  deleteAllPersonalNoteMessages(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.PERSONAL_NOTEBOARD }`,
      {
        data: noteData,
        params: {
          meetingID
        }
      }
    );
  }
  //#endregion

  //#region PRESENTER NOTE
  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  getPresenterNoteMessages(
    meetingID: Model['meetingID'],
    senderUserAccountID: Attendee['userAccountID'],
    roomID: Room['id']
  ): Observable<MeetingNote[]> {
    return this.axiosApiMessagesFacade.client.get(
      `${ RestAPI.PRESENTER_NOTEBOARD }/meetings/${ encodeURIComponent(meetingID) }/senders/${ encodeURIComponent(senderUserAccountID) }/rooms/${ encodeURIComponent(roomID) }`
    ).pipe(
      this.enrichNotesWithUserDetails(),
      catchError(error => {
        return throwError(new Error(`Failed loading presenter notes. ${ error.message }`));
      })
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  postPresenterNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.post(
      `${ RestAPI.PRESENTER_NOTEBOARD }`,
      noteData,
      {
        params: {
          meetingID
        },
        maxContentLength: serverConfig.CONFIG.axios.noteMaxContentLength,
        maxBodyLength: serverConfig.CONFIG.axios.noteMaxBodyLength
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  editPresenterNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.put(
      `${ RestAPI.PRESENTER_NOTEBOARD }`,
      noteData,
      {
        params: {
          meetingID
        },
        maxContentLength: serverConfig.CONFIG.axios.noteMaxContentLength,
        maxBodyLength: serverConfig.CONFIG.axios.noteMaxBodyLength
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  deletePresenterNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.PRESENTER_NOTEBOARD }`,
      {
        data: noteData,
        params: {
          meetingID
        }
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  deleteAllPresenterNoteMessages(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiMessagesFacade.client.delete(
      `${ RestAPI.PRESENTER_NOTEBOARD }`,
      {
        data: noteData,
        params: {
          meetingID
        }
      }
    );
  }
  //#endregion

  //#region PRIVATE METHODS
  private enrichNotesWithUserDetails() {
    return switchMap((responseMessages: any) => {
      const messages = responseMessages.data.meetingNotes || {};
      const userIdsDistinct = messages.map(m => m.creatorId).filter((user, index, arr) => arr.indexOf(user) == index);
      return this.axiosApiCoreFacade.client
        .post(RestAPI.POST_ACCOUNT_PERSONAL_DATA, { userIds: userIdsDistinct, pageNumber: 1, itemsPerPage: 999 })
        .pipe(
          map((responseUsers: any) => this.reMapMessage(messages, responseUsers.data.users || {}))
        );
    });
  }

  private reMapMessage(notes: MeetingNote[], users: UserAccountPersonalDataModel[]): MeetingNote[] {
    return notes.map(note => {
      const sender: UserAccountPersonalDataModel = users.find(x => x.userID === note.creatorId);
      return {
        ...note,
        creatorFirstName: sender  === undefined ? '' : sender.firstName,
        creatorLastName: sender  === undefined ? '' : sender.lastName
      } as MeetingNote;
    });
  }
  //#endregion
}
