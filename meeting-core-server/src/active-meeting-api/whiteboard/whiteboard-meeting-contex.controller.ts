import { Controller } from '@nestjs/common';
import { Room, UpdateMessageData, WhiteboardType } from '@container/models';
import { ActiveMeetingStore } from '../active-meeting.store';
import { fromEvent, Observable, of } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import {
  AttendeeUpdateEvent,
  RoomEditedEvent,
} from '../../com/apps/meeting/events/SessionEvents';
import {
  AttendeeInfoRequest,
  AttendeeInfoResponse,
  MeetingRequest,
  UpdateAttendeePropertiesResponse, UpdateRoomProperties_Properties,
  UpdateRoomPropertiesResponse,
  WhiteboardMeetingContextServiceController,
  WhiteboardMeetingContextServiceControllerMethods
} from '../../generated/whiteboard/whiteboard_meeting_context';
import { ActiveMeetingException } from '../exceptions/active-meeting-api.exception';

@Controller('WhiteboardMeetingContext')
@WhiteboardMeetingContextServiceControllerMethods()
export class WhiteboardMeetingContextController implements WhiteboardMeetingContextServiceController {

  constructor(private readonly meetingStore: ActiveMeetingStore) { }

  getAttendeeInfo(data: AttendeeInfoRequest): Observable<AttendeeInfoResponse> {
    const model = this.meetingStore.getMeetingModelById(data.meetingId);
    const attendee = model.attendeesIndex[data.attendeeId];

    if (!attendee) {
      throw new ActiveMeetingException('Missing attendee in whiteboard meeting context.');
    }

    let  room: Partial<Room> = model.roomsIndex[attendee.room];
    if (!room) {
      // if by any means the room does not exist, simply consider these props as locked
      room = {
        lockAnnotationsEraser: true,
        lockWhiteboardEraser: true,
        allowAttendeesToChangeGroupWBPage: false
      };
    }

    return  of({
      response: {
        id: data.attendeeId,
        role: attendee.role,
        room: attendee.room,
        roomConfig: room.roomConfiguration,
        lockAnnotations: attendee.lockAnnotations !== null ? attendee.lockAnnotations : room.lockAnnotations,
        lockWhiteboard: attendee.lockWhiteboard !== null ? attendee.lockWhiteboard : room.lockWhiteboard,
        lockAnnotationsEraser: room.lockAnnotationsEraser,
        lockWhiteboardEraser: room.lockWhiteboardEraser,
        allowAttendeesToChangeGroupWBPage: room.allowAttendeesToChangeGroupWBPage
      }
    });
  }

  updatePropertiesForAttendee(data: MeetingRequest): Observable<UpdateAttendeePropertiesResponse> {
    const eventBus = this.meetingStore.getMeetingEventBusById(data.meetingId);
    return fromEvent(eventBus, AttendeeUpdateEvent.type).pipe(
      filter((attendeeData: UpdateMessageData) => !!attendeeData.data),
      filter((attendeeData: UpdateMessageData) => {
        return typeof attendeeData.data.role !== 'undefined' ||
          typeof attendeeData.data.lockWhiteboard !== 'undefined' ||
          typeof attendeeData.data.lockAnnotations !== 'undefined';
      }),
      map((attendeeData: UpdateMessageData) => {
        return {
          response: {
            id: attendeeData.id,
          ...attendeeData.data
          }
        } as UpdateAttendeePropertiesResponse;
      })
    );
  }

  updatePropertiesForRoom(data: MeetingRequest): Observable<UpdateRoomPropertiesResponse> {
    const eventBus = this.meetingStore.getMeetingEventBusById(data.meetingId);
    return fromEvent(eventBus, RoomEditedEvent.type).pipe(
      filter((roomData: RoomEditedEvent) => {
        return typeof roomData.config.lockWhiteboard !== 'undefined' ||
          typeof roomData.config.lockAnnotations !== 'undefined' ||
          typeof roomData.config.lockAnnotationsEraser !== 'undefined' ||
          typeof roomData.config.lockWhiteboardEraser !== 'undefined' ||
          typeof roomData.config.allowAttendeesToChangeGroupWBPage !== 'undefined';
      }),
      map((roomData: RoomEditedEvent) => {
        return {
          response: {
            meetingId:  data.meetingId,
            roomId: roomData.id,
            wbType: this.getWbType(roomData.config),
            properties: {
            ...roomData.config
          }
        }
      };
      })
    );
  }

  // eslint-disable-next-line camelcase
  private getWbType(properties: UpdateRoomProperties_Properties): WhiteboardType {
    if (typeof properties.lockWhiteboard !== 'undefined' ||
      typeof properties.lockWhiteboardEraser !== 'undefined' ||
      typeof properties.allowAttendeesToChangeGroupWBPage !== 'undefined') {
      return WhiteboardType.GROUP;
    }

    if (typeof properties.lockAnnotations !== 'undefined' ||
      typeof properties.lockAnnotationsEraser !== 'undefined') {
      return WhiteboardType.ANNOTATION;
    }

    return WhiteboardType.GROUP;
  }
}


