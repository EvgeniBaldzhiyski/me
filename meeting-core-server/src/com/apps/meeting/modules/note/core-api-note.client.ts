import AxiosApiClientFacade from '../../../../utils/axios-api-client.facade';
import { Attendee, MeetingNote, Model, RestAPI, Room } from '@container/models';
import { ApmSpan, FunctionalDomainType } from '@container/apm-utils';
import { AxiosObservable } from 'axios-observable/dist/axios-observable.interface';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { NoteInterface  } from './note.interface';
import serverConfig from '../../../../utils/serverConfig';

/**
 * Stateless Axios Client for the Message API Gateway for the Chat Domain
 */
 export class CoreApiNoteClient implements NoteInterface {
  private axiosApiCoreFacade = new AxiosApiClientFacade('core');

  constructor() {}

  //#region GROUP NOTE
  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  getGroupNoteMessages(
    meetingID: Model['meetingID'],
    senderUserAccountID: Attendee['userAccountID'],
    roomID: Room['id']
  ): Observable<MeetingNote[]> {
    return this.axiosApiCoreFacade.client.get(
      `${ RestAPI.GROUP_NOTEBOARD }`,
      {
        params: {
          meetingID,
          senderUserAccountID,
          roomId: roomID
        }
      }
    ).pipe(
      map((result: any) => this.reMapMessage(result.data))
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  postGroupNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiCoreFacade.client.post(
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
    return this.axiosApiCoreFacade.client.put(
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
    return this.axiosApiCoreFacade.client.delete(
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
    return this.axiosApiCoreFacade.client.delete(
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
    return this.axiosApiCoreFacade.client.get(
      `${ RestAPI.PERSONAL_NOTEBOARD }`,
      {
        params: {
          meetingID,
          senderUserAccountID
        }
      }
    ).pipe(
      map((result: any) => this.reMapMessage(result.data))
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  postPersonalNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiCoreFacade.client.post(
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
    return this.axiosApiCoreFacade.client.put(
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
    return this.axiosApiCoreFacade.client.delete(
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
    return this.axiosApiCoreFacade.client.delete(
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
    return this.axiosApiCoreFacade.client.get(
      `${ RestAPI.PRESENTER_NOTEBOARD }`,
      {
        params: {
          meetingID,
          senderUserAccountID,
          roomId: roomID
        }
      }
    ).pipe(
      map((result: any) => this.reMapMessage(result.data))
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  postPresenterNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void> {
    return this.axiosApiCoreFacade.client.post(
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
    return this.axiosApiCoreFacade.client.put(
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
    return this.axiosApiCoreFacade.client.delete(
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
    return this.axiosApiCoreFacade.client.delete(
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
  private reMapMessage(notes: MeetingNote[]): MeetingNote[] {
    return notes.map(note => {
      return {
        ...note,
        timestamp: note.timestamp * (note.timestamp < 10000000000 ? 1000 : 1)
      } as MeetingNote;
    });
  }
  //#endregion
}
