import { Controller } from '@nestjs/common';
import { fromEvent, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { ActiveMeetingStore } from '../active-meeting.store';
import { ActiveMeetingEventStream } from '../active-meeting-event.stream';
import {
  ActiveMeetingContextServiceController,
  ActiveMeetingContextServiceControllerMethods,
  ClonedRoomResponse,
  MeetingId, RemoveRoomResponse, SessionCloseResponse,
} from '../../generated/active_meeting_context';
import {
  ClonedRoomIdsCreatedEvent,
  SessionCloseEvent,
  SessionEventTypes
} from '../../com/apps/meeting/events/SessionEvents';

@Controller('ActiveMeetingContext')
@ActiveMeetingContextServiceControllerMethods()
export class ActiveMeetingContextService implements ActiveMeetingContextServiceController {

  constructor(
    private readonly meetingEventStream: ActiveMeetingEventStream,
    private readonly meetingStore: ActiveMeetingStore
  ) { }

  removeRoom(data: MeetingId): Observable<RemoveRoomResponse> {
    const eventBus = this.meetingStore.getMeetingEventBusById(data.meetingId);
    return fromEvent(eventBus, SessionEventTypes.ROOM_CLOSE).pipe(
      map((roomId: string) => {
        return {
          response: {
            meetingId:  data.meetingId,
            roomId: roomId
          }
        };
      })
    );
  }

  sessionClose(data: MeetingId): Observable<SessionCloseResponse> {
    const eventBus = this.meetingStore.getMeetingEventBusById(data.meetingId);
    return fromEvent(eventBus, SessionCloseEvent.type).pipe(
      map(() => {
        return {
          response: { meetingId: data.meetingId }
        };
      })
    );
  }

  createClonedMainRoom(data: MeetingId): Observable<ClonedRoomResponse> {
    const eventBus = this.meetingStore.getMeetingEventBusById(data.meetingId);
    return fromEvent(eventBus, ClonedRoomIdsCreatedEvent.type).pipe(
      filter((roomIds: string[]) => roomIds.length > 0),
      map((roomIds: string[]) => {
        return {
          response: {
            meetingId:  data.meetingId,
            roomIds
          }
        };
      })
    );
  }

}
