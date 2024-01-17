import { Model, EmojisId } from '@container/models';

enum FunctionalAreas {
  MeetingTemplate = 'Meeting Template',
  ActiveMeeting = 'Active Meeting',
  Whiteboard = 'Whiteboard',
  Feedback = 'Feedback',
  Chat = 'Chat',
  Notes = 'Notes',
  Reports = 'Reports',
  AssetLibrary = 'Asset Library',
  Camera = 'Camera',
  Poll = 'Poll'
}

export enum PollEventNames {
  POLL_START = "PollStart",
  POLL_SEND_ANSWER = "PollSendAnswer"
}

export interface FAEvent {
  readonly fa: FunctionalAreas;
  readonly entity: string;
  // or enum with all events?
  eventName: string;
  payload: FunctionalAreaEntity;

  getKafkaTopic(topicPrefix?: string): string;
  isValid(): boolean;
}

export interface FunctionalAreaEntity {
  _id: string;
  ts: number;
}

export class FunctionalAreaEvent<PayloadType extends FunctionalAreaEntity> implements FAEvent {
  fa: FunctionalAreas;
  entity = 'FunctionalAreaEntity';

  getKafkaTopic(topicPrefix?: string): string {
    if (topicPrefix == null) {
      topicPrefix = '';
    } else if (!topicPrefix.endsWith('-')) {
      topicPrefix += '-';
    }
    // remove white spaces. fa topic names should be lower case
    return `${topicPrefix}fa-${this.fa.replace(/(\s*)/g, '').toLowerCase()}`;
  }

  isValid(): boolean {
    return true;
  }

  isValidMeetingAttendeeId(maid: string): boolean {
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return maid && guidPattern.test(maid);
  }

  constructor(
    public eventName: string,
    public payload: PayloadType
  ) { }
}

export class ActiveMeetingEvent extends FunctionalAreaEvent<ActiveMeetingEventPayload> {
  readonly fa = FunctionalAreas.ActiveMeeting;
  readonly entity = 'ActiveMeetingEventPayload';

  isValid(): boolean {
    return !this.payload.attendee || this.isValidMeetingAttendeeId(this.payload.attendee.meetingAttendeeId);
  }
}

export class ChatEvent extends FunctionalAreaEvent<ChatEventPayload> {
  readonly fa = FunctionalAreas.Chat;
  readonly entity = 'ChatEventPayload';

  isValid(): boolean {
    return this.payload.sender && this.isValidMeetingAttendeeId(this.payload.sender.meetingAttendeeId);
  }
}

export class FeedbackEvent extends FunctionalAreaEvent<FeedbackEventPayload> {
  readonly fa = FunctionalAreas.Feedback;
  readonly entity = 'FeedbackEventPayload';

  isValid(): boolean {
    return this.payload.attendee && this.isValidMeetingAttendeeId(this.payload.attendee.meetingAttendeeId);
  }
}

export class CameraEvent extends FunctionalAreaEvent<CameraEventPayload> {
  readonly fa = FunctionalAreas.Camera;
  readonly entity = 'CameraEventPayload';

  isValid(): boolean {
    return this.payload.attendee && this.isValidMeetingAttendeeId(this.payload.attendee.meetingAttendeeId);
  }
}

export class QuickPollEvent extends FunctionalAreaEvent<QuickPollEventPayload> {
  readonly fa = FunctionalAreas.Poll;
  readonly entity = 'QuickPollEventPayload';

  isValid(): boolean {
    return this.payload.attendee && this.isValidMeetingAttendeeId(this.payload.attendee.meetingAttendeeId);
  }
}

export class PollEvent extends FunctionalAreaEvent<PollEventPayload> {
  readonly fa = FunctionalAreas.Poll;
  readonly entity = 'PollEventPayload';

  isValid(): boolean {
    return this.payload.attendee && this.isValidMeetingAttendeeId(this.payload.attendee.meetingAttendeeId);
  }
}

export interface MeetingCommonData {
  companyId: string;
  /**
   * @see Model.meetingID
   */
  meetingId: Model['meetingID'];
  /**
   * @see Model.meetingRunID
   */
  meetingRunId: Model['meetingRunID'];
}
export interface MeetingEventBaseData extends MeetingCommonData {
  sessionRunDuration?: number;
  maxAttendeesInRun?: number;
}

export interface AttendeeCommonData {
  userAccountId: string;
  meetingAttendeeId: string;
}

export interface AttendeeEventBaseData extends AttendeeCommonData {
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
  durationInRun?: number;
  isRejoin?: boolean;
  role: string;
}

export interface RoomCheckEventData {
  checkType: string;
  reason?: string;
  targetAttendeesCount?: number;
  roomId?: string;
  isBanned?: boolean;
}

export type ActiveMeetingEventPayload = FunctionalAreaEntity & {
  meeting: MeetingEventBaseData;
  attendee?: AttendeeEventBaseData;
  roomCheck?: RoomCheckEventData;
};

export type ChatEventPayload = FunctionalAreaEntity & {
  meeting: MeetingCommonData;
  sender: AttendeeCommonData;
  recipient?: AttendeeCommonData | null;
  roomIds?: string[] | null;
  isBroadcast: boolean;
};

export type FeedbackEventPayload = FunctionalAreaEntity & {
  meeting: MeetingCommonData,
  attendee: AttendeeCommonData,
  feedbackEmojiId: EmojisId
};

export type CameraEventPayload = FunctionalAreaEntity & {
  meeting: MeetingCommonData,
  attendee: AttendeeCommonData
};

export interface QuickPollInfo {
  id: string;
  name: string;
  question: string;
  initiatorMeetingAttendeeId: string;
  runId: string;
}

export interface PollInfo {
  type: number;
  name: string;
  description: string;
  questions: PollQuestion[];
  initiatorMeetingAttendeeId: string;
  runId: string;
}

export interface PollQuestion {
  name: string;
  title: string;
  description: string;
  correctAnswer: any;
}

export interface PollAnswer {
  name: string;
  title: string;
  value: any;
}

export type QuickPollEventPayload = FunctionalAreaEntity & {
  meeting: MeetingCommonData,
  attendee: AttendeeCommonData,
  roomId: string,
  attendeesCount?: number,
  poll: QuickPollInfo,
  answer?: string
};

export type PollEventPayload = FunctionalAreaEntity & {
  meeting: MeetingCommonData,
  attendee: AttendeeCommonData,
  roomId: string,
  attendeesCount?: number,
  poll: PollInfo,
  answers?: PollAnswer[]
};
