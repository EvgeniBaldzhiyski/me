import apm from 'elastic-apm-node/start';
import { EventEmitter } from 'events';
import {
  Model,
  Attendee,
  UpdateMessageData,
  ServiceAccess,
  AdminClientCommands,
  ErrorCodes,
  Room
} from '@container/models';
import { ApmTransaction, TransactionType } from '@container/apm-utils';
import { Application } from '../../utils/Application';
import Client from '../../utils/Client';
import { AppInstanceMessagingEvents } from '../../utils/AppInstance';
import { BaseModuleCtor, BaseModuleInterface } from './modules/BaseModule';
import { MeetingMessagingCommands } from '../meeting/events/MessagingAPI';
import BorManagerModule from './modules/bor-manager/BorManagerModule';
import { rejectConnection } from '../utils/shared';

const modules: Record<string, BaseModuleCtor> = {
  [ServiceAccess.BOR_MANAGER]: BorManagerModule,
};

export default class Admin extends Application {
  protected _modules: Record<string, BaseModuleInterface> = {};

  model: Model;
  onMessage = new EventEmitter();

  async setup() {
    this.logger.info(`Executing setup in the Admin App with modules `, modules);
    Object.keys(modules).forEach(id => {
      this._modules[id] = new (modules[id])(this, id as ServiceAccess);
      this._modules[id].setup();
    });

    await super.setup();

    this.server.onMessage('*', ({ command, data, source }) => this._onMessage(command, data, source));
    this.server.sendMessage(AppInstanceMessagingEvents.INIT, null);
  }

  async destruct() {
    const clientList = [];
    for (const [_, client] of this.server.clients) {
      clientList.push(client.id);
    }
    await this.server.disconnect(clientList, 32467);

    await Promise.all(
      Object.values(this._modules || {}).map(async (module) => {
        try {
          return await module.destruct();
        } catch (err) {
          apm.captureError(err);
          this.logger.error(`AdminApplication got error when calling ${typeof module}.destruct. ${err.message}`);
          // noop we have no other means to deal with this error
        }
      })
    );

    this.onMessage.removeAllListeners();
    return super.destruct();
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onConnect(client: Client) {
    if (!this.model) {
      rejectConnection(this.server, client, this, ErrorCodes.KILL, 'Model is not defined in admin');
      return;
    }

    this.logger.info(`A new connection in the Admin App has arrived mid ${this.model.meetingID}.`);
    this.server.sendTo(AdminClientCommands.MEETING_INIT, {model: this.model}, client.id);
    this.onMessage.emit(AppInstanceMessagingEvents.INIT, this.model);

    Object.values(this._modules).forEach(m => m.onConnect.call(m, client));
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onDisconnect(client: Client) {
    Object.values(this._modules).forEach(m => m.onDisconnect.call(m, client, true));
  }

  private _onMessage(id, data, { name, type }) {
    if (type === 'meeting' && this.name === name) {
      switch (id) {
        case AppInstanceMessagingEvents.INIT:
          this.onSessionOpen(data as Model); break;

        case MeetingMessagingCommands.ATTENDEE_JOIN:
          this.onAttendeeJoin(data); break;
        case MeetingMessagingCommands.ATTENDEE_REMOVE:
          this.onAttendeeRemove(data as string); break;
        case MeetingMessagingCommands.ATTENDEE_UPDATE:
          this.onAttendeeUpdate(data as UpdateMessageData); break;

        case MeetingMessagingCommands.ROOM_ADD:
          this.onRoomAdd(data);
          break;
        case MeetingMessagingCommands.ROOM_EDIT:
          this.onRoomEdit(data);
          break;
        case MeetingMessagingCommands.ROOM_REMOVE_IN_PROGRESS:
          this.onRoomRemoveInProgress(data);
          break;
        case MeetingMessagingCommands.ROOM_REMOVE_FAILED:
          this.onRoomRemoveFailed(data);
          break;
        case MeetingMessagingCommands.ROOM_REMOVE:
          this.onRoomRemove(data);
          break;
      }

      this.onMessage.emit(id, data);
    }
  }
  private onSessionOpen(data) {
    this.model = data;
    this.logger.info(`A new session in the Admin App has been opened with mid ${this.model.meetingID}.`);
    this.server.sendTo(AdminClientCommands.MEETING_INIT, { model: this.model });
  }

  private onAttendeeJoin(a: Partial<Attendee>) {
    if (this.model) {
      this.model.attendeesIndex[a.id] = new Attendee(a);
    }
  }
  private onAttendeeRemove(aid: Attendee['id']) {
    if (this.model) {
      delete this.model.attendeesIndex[aid];
    }
  }
  private onAttendeeUpdate({ id, data }: {id: Attendee['id'], data: Partial<Attendee>}) {
    if (this.model) {
      Object.assign(this.model.attendeesIndex[id], data);
    }
  }

  private onRoomAdd(room: Room) {
    if (this.model && this.model.roomsIndex) {
      this.model.roomsIndex[room.id] = room;
    }
  }

  private onRoomEdit(room: Room) {
    if (this.model && this.model.roomsIndex) {
      this.model.roomsIndex[room.id] = room;
    }
  }

  private onRoomRemoveInProgress({id}: {id: Room['id']}) {
    if (this.model && this.model.roomsIndex && this.model.roomsIndex[id]) {
      this.model.roomsIndex[id].removing = true;
    }
  }

  private onRoomRemoveFailed({id}: {id: Room['id']}) {
    if (this.model && this.model.roomsIndex && this.model.roomsIndex[id]) {
      this.model.roomsIndex[id].removing = false;
    }
  }


  private onRoomRemove({id}: {id: Room['id']}) {
    if (this.model && this.model.roomsIndex) {
      delete this.model.roomsIndex[id];
    }
  }
}
