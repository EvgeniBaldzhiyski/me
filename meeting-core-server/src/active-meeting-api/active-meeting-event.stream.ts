import Server from '../com/utils/Server';
import Meeting from '../com/apps/meeting/Meeting';
import { fromEvent, merge, Observable } from 'rxjs';
import { AttendeeJoinSuccessEvent, AttendeeLeftEvent } from '../com/apps/meeting/events/SessionEvents';
import { map } from 'rxjs/operators';
import { Attendee } from '@container/models';
import { ActiveMeetingException } from './exceptions/active-meeting-api.exception';

export class ActiveMeetingEventStream {

  constructor(private readonly server: Server) {}

  events(id: string): Observable<Attendee> {
    const meeting = this.server.getAppInstanceByName('meeting', id);
    if (meeting?.app instanceof Meeting) {
      const eventBus = meeting.app.eventBus;
      return merge(
        fromEvent(eventBus, AttendeeJoinSuccessEvent.type).pipe(
          map(([attendee, _]) => attendee)
        ),
        fromEvent(eventBus, AttendeeLeftEvent.type).pipe(
          map(({attendee}) => {
            return { ...attendee, left: true};
          })
        )
      );
    }

    throw new ActiveMeetingException('Missing meeting application.');
  }
}
