import { ApmSpan } from '@container/apm-utils';
import { Attendee, Model, RestAPI, Room } from '@container/models';
import { coreApiObservable } from '../../../../utils/coreApiClient';

export class CoreApiLayoutClient {

  @ApmSpan()
  applyLayout (rid: Room['id'], layout: any, meetingId: Model['meetingID'], aid: Attendee['id']) {
    return coreApiObservable.post(
      RestAPI.LAYOUT_SAVE,
      {
        [rid || 'main']: layout
      },
      {
        params: { meetingId }
      }
    );
  }

  @ApmSpan()
  loadLayoutSettings (rid: Room['id'], mid: Model['meetingID']) {
    return coreApiObservable.get(
      RestAPI.LAYOUT,
      {
        params: { mid, borid: rid || null }
      }
    )
  }
}
