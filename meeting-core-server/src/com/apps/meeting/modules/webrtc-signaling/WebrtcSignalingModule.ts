import BaseModule from "./../BaseModule";
import Meeting from "../../Meeting";
import { ClientConnectionAPI, ServerConnectionAPI, WebrtcSignalingData } from '@container/models';

export default class WebrtcSignalingModule extends BaseModule {
  constructor(
    protected inst: Meeting
  ) {
    super(inst);

    this.inst.server.onSocket(
      ServerConnectionAPI.WEB_RTC_SIGNALING,
      (client, data: WebrtcSignalingData) => {
        // we just broadcast to all
        // TODO: we may do some checking here

        if (data.receiverId) {
          this.inst.sendToAttendee(data.receiverId, ClientConnectionAPI.WEB_RTC_SIGNALING, data);
        } else {
          this.inst.roomEngine.sendToRoom(data.roomId, ClientConnectionAPI.WEB_RTC_SIGNALING, data);
          // this.inst.server.sendTo(ClientConnectionAPI.WEB_RTC_SIGNALING, data);
        }
      });
  }
}



