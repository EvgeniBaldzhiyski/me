import { Attendee, MeetingNote, Model, Room } from '@container/models';
import { AxiosObservable } from 'axios-observable/dist/axios-observable.interface';
import { Observable } from 'rxjs';

export interface NoteInterface {
  //#region GROUP NOTE
  getGroupNoteMessages(
    meetingID: Model['meetingID'],
    senderUserAccountID: Attendee['userAccountID'],
    roomID: Room['id']
  ): Observable<MeetingNote[]>;

  postGroupNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  editGroupNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  deleteGroupNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  deleteAllGroupNoteMessages(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;
  //#endregion

  //#region PERSONAL NOTE
  getPersonalNoteMessages(
    meetingID: Model['meetingID'],
    senderUserAccountID: Attendee['userAccountID']
  ): Observable<MeetingNote[]>;

  postPersonalNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  editPersonalNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  deletePersonalNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  deleteAllPersonalNoteMessages(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;
  //#endregion

  //#region PRESENTER NOTE
  getPresenterNoteMessages(
    meetingID: Model['meetingID'],
    senderUserAccountID: Attendee['userAccountID'],
    roomID: Room['id']
  ): Observable<MeetingNote[]>;

  postPresenterNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  editPresenterNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  deletePresenterNoteMessage(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;

  deleteAllPresenterNoteMessages(meetingID: Model['meetingID'], noteData): AxiosObservable<void>;
  //#endregion
}
