import { DynamicModule } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { ActiveMeetingController } from './active-meeting.controller';
import {
  ActiveMeetingContextService
} from './active-meeting-context/active-meeting-context.controller';
import { ActiveMeetingStore } from './active-meeting.store';
import { ActiveMeetingEventStream } from './active-meeting-event.stream';
import { WhiteboardMeetingContextController } from './whiteboard/whiteboard-meeting-contex.controller';
import { ActiveMeetingSchedulingService } from './active-meeting-scheduling/active-meeting-scheduling.controller';
import { PendingWorkloadsStore } from './active-meeting-scheduling/pending-workloads.store';
import { APP_FILTER } from '@nestjs/core';
import { ActiveMeetingApiExceptionFilter } from './filters/active-meeting-api.filter';

export class AppModule {
  static register(server): DynamicModule {
    return {
      module: AppModule,
      imports: [ScheduleModule.forRoot()],
      controllers: [
        ActiveMeetingController,
        ActiveMeetingContextService,
        ActiveMeetingSchedulingService,
        WhiteboardMeetingContextController],
      providers: [
        {
          provide: PendingWorkloadsStore,
          useFactory(schedulerRegistry: SchedulerRegistry) {
            return new PendingWorkloadsStore(server, schedulerRegistry);
          },
          inject: [SchedulerRegistry]
        },
        {
          provide: ActiveMeetingStore,
          useFactory() {
            return new ActiveMeetingStore(server);
          }
        },
        {
          provide: ActiveMeetingEventStream,
          useFactory() {
            return new ActiveMeetingEventStream(server);
          }
        },
        {
          provide: APP_FILTER,
          useClass: ActiveMeetingApiExceptionFilter
        }
      ]
    };
  }
}
