import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import BaseModule from './../BaseModule';
import Meeting from '../../Meeting';
import {
  Attendee,
  ClientConnectionAPI,
  LaserPointerContainer,
  LaserPointerEvent,
  LaserPointerState,
  Room,
  ServerConnectionAPI
} from '@container/models';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import Client from '../../../../utils/Client';

export default class LaserPointerModule extends BaseModule {
  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);
  }

  @ApmSpan()
  approveAttendeeChange(_, id, data, done) {
    const attendee = this.inst.model.attendeesIndex[id];

    if (data.room !== undefined || data.hasBaton === false || data.left) {
      this.release(attendee.room, id);
    }

    done(data);
  }

  @Socket(ServerConnectionAPI.LASER_POINTER_EVENT)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private setCoordinates(@client client: Client, data: LaserPointerEvent) {
    const sender = this.inst.model.attendeesIndex[client.data.aid];
    const room = this.inst.model.roomsIndex[sender && sender.room];

    if (!sender || !room) {
      return;
    }

    if (room.laserPointerHolder[data.container] !== sender.id) {
      return;
    }

    this.inst.roomEngine.sendToRoom(room.id, ClientConnectionAPI.LASER_POINTER_EVENT, data);
  }

  @Socket(ServerConnectionAPI.LASER_POINTER_STATE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private changeState(@client client: Client, { container, state }: LaserPointerState) {
    const sender = this.inst.model.attendeesIndex[client.data.aid];
    const room = this.inst.model.roomsIndex[sender && sender.room];

    if (!sender || !room) {
      return;
    }

    const cnt = room.laserPointerHolder[container];

    if (cnt && cnt !== sender.id && !this.inst.roomEngine.isHost(sender)) {
      return;
    }

    if (state) {
      this.apply(room.id, sender.id, container);
    } else {
      this.release(room.id, sender.id, container);
    }
  }

  @ApmSpan()
  private release(roomId: Room['id'], holder: Attendee['id'], cnt: LaserPointerContainer | '*' = '*') {
    const room = this.inst.model.roomsIndex[roomId];

    if (!room) {
      return;
    }

    const laserPointerHolder = { ...room.laserPointerHolder };
    let impact = false;

    if (cnt === '*') {
      for(const key in laserPointerHolder) {
        if (laserPointerHolder[key] === holder) {
          delete laserPointerHolder[key];
          impact = true;
        }
      }
    } else {
      if (laserPointerHolder[cnt]) {
        impact = true;
      }
      delete laserPointerHolder[cnt];
    }

    if (impact) {
      this.inst.roomEngine.updateRoom(room.id, { laserPointerHolder });
    }
  }

  @ApmSpan()
  private apply(roomId: Room['id'], holder: Attendee['id'], container: LaserPointerContainer) {
    const room = this.inst.model.roomsIndex[roomId];

    if (!room) {
      return;
    }

    if (room.laserPointerHolder[container] && room.laserPointerHolder[container] === holder) {
      return;
    }

    const laserPointerHolder = { ...room.laserPointerHolder, [container]: holder };

    this.inst.roomEngine.updateRoom(room.id, { laserPointerHolder });
  }
}
