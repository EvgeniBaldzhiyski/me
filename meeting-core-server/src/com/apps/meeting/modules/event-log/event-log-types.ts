import { Model, Roles } from '@container/models';

export enum LogTriggerType {
  Meeting = 'Meeting',
  Attendee = 'Attendee',
  Room = 'Room',
  Timeout = 'Timeout'
}
export enum LogTriggerAction {
  Enter = 'Enter',
  StepAway = 'StepAway',
  GoBack = 'GoBack',
  Leave = 'Leave',
  KickOff = 'KickOff'
}
export interface EventLogAttendeeProps {
  AttID: string;
  AttFirstName: string;
  AttLastName: string;
  AttEmail: string;
  EventRole: Roles;
  ExternalAttID: string;
}
export interface EventLogSessionProps {
  CompanyID: string;
  /**
   * @see Model.meetingID
   */
  SessionID: Model['meetingID'];
  /**
   * @see Model.meetingRunID
   */
  SessionRunID: Model['meetingRunID'];
  HostID: string;
  SessionName: string;
}
export interface EventLogAdditionalData {
  SessionStartTime: string;
  SessionEndTime: string;
  SessionTimeZoneOffset: string;
  SessionDays: string;
  HostFirstName: string;
  HostLastName: string;
  HostEmail: string;

  ExternalCourseID: string;
  ExternalHostID: string;
}


export interface EventMetadata {
  EventType: LogTriggerType;
  EventAction: LogTriggerAction;
  LogMessage?: string;
}

export type EventProps = EventLogAttendeeProps & EventMetadata;
export type EventPayload = EventLogSessionProps & EventLogAdditionalData & EventProps & {
  ServerDateTime: string;
};
