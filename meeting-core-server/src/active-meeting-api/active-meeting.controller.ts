import { Controller } from '@nestjs/common';
import { GrpcMethod} from '@nestjs/microservices';
import { ActiveMeetingStore } from './active-meeting.store';
import { ActiveMeetingEventStream } from './active-meeting-event.stream';

export interface DummyParamById {
  id: string;
}

@Controller('ActiveMeeting')
export class ActiveMeetingController {

  constructor(
    private readonly meetingEventStream: ActiveMeetingEventStream,
    private readonly meetingStore: ActiveMeetingStore
  ) { }

  @GrpcMethod('ActiveMeetingService', 'GetActiveMeeting')
  getActiveMeeting(data: DummyParamById) {
    return this.meetingStore.getMeetingModelById(data.id);
  }
}
