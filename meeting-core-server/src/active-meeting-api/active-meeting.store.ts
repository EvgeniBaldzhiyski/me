import Server from '../com/utils/Server';
import Meeting from '../com/apps/meeting/Meeting';
import EventEmitter from 'events';
import { ActiveMeetingException } from './exceptions/active-meeting-api.exception';

export class ActiveMeetingStore {
  constructor(private readonly server: Server) { }

  getMeetingModelById(id: string) {
    const meeting = this.server.getAppInstanceByName('meeting', id);
    if (meeting?.app instanceof Meeting) {
      return meeting.app.model;
    }

    throw new ActiveMeetingException('Missing meeting model in active meeting store.');
  }

  getMeetingEventBusById(id: string): EventEmitter {
    const meeting = this.server.getAppInstanceByName('meeting', id);
    if (meeting?.app instanceof Meeting) {
      return meeting.app.eventBus;
    }

    throw new ActiveMeetingException('Missing meeting event bus in active meeting store.');
  }
}
