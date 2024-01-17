import { Attendee, Model,  PollForRoom, Roles, Room } from '@container/models';
import {
  AttendeeCommonData,
  AttendeeEventBaseData,
  MeetingCommonData,
  MeetingEventBaseData,
  PollAnswer,
  PollInfo,
  PollQuestion,
  QuickPollInfo
} from './fa-event-types';

export default class KafkaUtils {
  static getAttendeeCommonData(attendee: Attendee): AttendeeCommonData {
    return {
      meetingAttendeeId: attendee.id,
      userAccountId: attendee.userAccountID
    };
  }

  static createAttendeeCommonData(meetingAttendeeId: string, userAccountId: string): AttendeeCommonData {
    return {
      meetingAttendeeId,
      userAccountId
    };
  }

  static getMeetingCommonData(model: Model): MeetingCommonData {
    return {
      meetingId: model.meetingID,
      meetingRunId: model.meetingRunID,
      // TODO: check if this is really needed as `sessionSettings` are loaded later on and may be empty in some cases
      companyId: model.sessionSettings?.companyId || undefined
    };
  }

  static getAttendeePropertiesForKafka(attendee: Attendee, durationInRun?: number, isRejoin?: boolean): AttendeeEventBaseData {
    return {
      meetingAttendeeId: attendee.id,
      userAccountId: attendee.userAccountID,
      browserName: attendee.browserName,
      browserVersion: attendee.browserVersion,
      osName: attendee.osName,
      osVersion: attendee.osVersion,
      durationInRun: durationInRun,
      isRejoin: isRejoin,
      role: attendee.role
    };
  }

  static getMeetingPropertiesForKafka(model: Model, sessionRunDuration?: number, maxAttendeesInRun?: number): MeetingEventBaseData {
    return {
      meetingId: model.meetingID,
      meetingRunId: model.meetingRunID,
      // TODO: check if this is really needed as `sessionSettings` are loaded later on and may be empty in some cases
      companyId: model.sessionSettings?.companyId || undefined,
      sessionRunDuration: sessionRunDuration,
      maxAttendeesInRun: maxAttendeesInRun
    };
  }

  // @todo this tool is useful and it is not in the context of kafka only, so consider to move it on better location
  static getAttendeesCount(attendeesIndex: Record<Attendee['id'], Attendee>, senderRoomId: Room['id'],
    senderId: Attendee['id']): number {
    let length = 0;
    for (const aid in attendeesIndex) {
      const {id, left, room, role} = attendeesIndex[aid];
      if (id !== senderId && !left && room === senderRoomId && role !== Roles.GHOST) {
        length++;
      }
    }
    return length;
  }

  static getQuickPollInfo(pollForRoom: PollForRoom): QuickPollInfo {
    return {
      id: pollForRoom.id,
      name: pollForRoom.pollName,
      question: pollForRoom.pollQuestion,
      initiatorMeetingAttendeeId: pollForRoom.pollInitiator,
      runId: pollForRoom.pollRunId
    };
  }

  static getPollInfo(pollForRoom: object): PollInfo {
    return {
      type: pollForRoom['type'],
      name: pollForRoom['name'],
      description: pollForRoom['description'],
      questions: this.getPollQuestions(pollForRoom['survey']['pages']),
      initiatorMeetingAttendeeId: pollForRoom['attendeeId'],
      runId: pollForRoom['meetingAssessmentRunID']
    };
  }

  private static getPollQuestions(pages: any): PollQuestion[] {
    const result = [];
    (pages || []).forEach(page => {
      (page['elements'] || []).forEach(el => {
        result.push({
          name: el['name'],
          title: el['title'] || el['name'],
          description: el['description'],
          correctAnswer: el['correctAnswer']
        });
      });
    });

    return result;
  }

  static getPollAnswers(answers: any): PollAnswer[] {
    return (answers || []).map(ans => {
      return {
        name: ans['name'],
        title: ans['title'],
        value: ans['value']
      };
    });
  }
}
