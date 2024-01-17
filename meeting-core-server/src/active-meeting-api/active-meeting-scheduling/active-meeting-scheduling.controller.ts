import { Controller } from '@nestjs/common';
import {
  ActiveMeetingSchedulingServiceController,
  ActiveMeetingSchedulingServiceControllerMethods,
  SchedulingParameters,
  SchedulingResult
} from '../../generated/active_meeting_scheduling';
import { Observable, of } from 'rxjs';
import config from 'config';
import { PendingWorkloadsStore } from './pending-workloads.store';

@Controller('ActiveMeetingSchedulingService')
@ActiveMeetingSchedulingServiceControllerMethods()
export class ActiveMeetingSchedulingService implements ActiveMeetingSchedulingServiceController {
  constructor(private pendingWorkloadsStore: PendingWorkloadsStore) {
  }
  schedule(request: SchedulingParameters): Observable<SchedulingResult> {
    if (!config.get('serviceRegistry.enabled')) {
      return of({ result: false });
    }

    if (!request.sessionId) {
      return of({ result: false });
    }

    this.pendingWorkloadsStore.add(request.sessionId);
    return of({ result: true });
  }
}
