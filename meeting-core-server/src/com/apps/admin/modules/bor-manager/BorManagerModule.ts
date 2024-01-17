import BaseModule from '../BaseModule';
import Client from '../../../../utils/Client';
import { MeetingMessagingCommands } from '../../../meeting/events/MessagingAPI';
import { AppInstanceMessagingEvents } from '../../../../utils/AppInstance';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import { Guard } from '../../../../gateway/decorators/class.decorator';
import { Get, Socket } from '../../../../gateway/decorators/method.decorator';
import { client, res } from '../../../../gateway/decorators/argument.decorator';
import { JwtSubjects } from '../../../../gateway/types';
import {
  AttendeeBase,
  AdminClientCommands,
  AdminServerCommands,
  AdminCommandAttendeesAssign,
  AdminCommandRoomAdd,
  AdminCommandRoomRemove,
  AdminCommandRoomReload,
  AdminCommandRoomAddAtt,
  AdminCommandRoomMoveAtt,
  AdminCommandRoomBringbackAtts,
  AdminCommandBringBackPdfs,
  AdminCommandAttendeeMakeLead,
  AdminBorManagerCommand,
  BorManagerState,
  OperationStatus,
  AdminCommandModifyAsset,
  Room
} from '@container/models';
import { ServerResponse } from '../../../../utils/Server';


@Guard([JwtSubjects.BOR_API_SERVER])
export default class BorManagerModule extends BaseModule {
  private sessionActive = false;
  private currentBorState = {
    currentBorManagerHolder: null,
    state: BorManagerState.CLOSED,
    currentBorManagerHolderName: '',
    connClientId: '',
  };

  setup() {
    // this.inst.onMessage.on(MeetingMessagingCommands.ATTENDEE_JOIN, data => this.onAddAttendee(data));
    // this.inst.onMessage.on(MeetingMessagingCommands.ATTENDEE_REMOVE, data => this.onRemoveAttendee(data));
    this.inst.onMessage.on(MeetingMessagingCommands.ASSET_UPDATE, (data) => {
      this.sendTo(AdminClientCommands.ASSET_UPDATE, data);
    });
    this.inst.onMessage.on(MeetingMessagingCommands.ATTENDEE_UPDATE, ({ id, data }) => this.onUpdateAttendee(id, data));
    this.inst.onMessage.on(MeetingMessagingCommands.ROOM_REMOVE_IN_PROGRESS, ({ id }) => {
      this.sendTo(AdminClientCommands.ROOM_REMOVE, { id, status: OperationStatus.IN_PROGRESS });
    });
    this.inst.onMessage.on(MeetingMessagingCommands.ROOM_REMOVE, ({ id }) => {
      this.sendTo(AdminClientCommands.ROOM_REMOVE, { id, status: OperationStatus.DONE });
    });
    this.inst.onMessage.on(MeetingMessagingCommands.ROOM_REMOVE_FAILED, ({ id }) => {
      this.sendTo(AdminClientCommands.ROOM_REMOVE, { id, status: OperationStatus.FAILED });
    });

    this.inst.onMessage.on(AppInstanceMessagingEvents.INIT, (model) => {
      if (model !== undefined) {
        this.sessionActive = true;
      }

      this.sendTo(AdminClientCommands.SESSION_ACTIVITY, this.sessionActivity());
    });

    this.inst.onMessage.on(AppInstanceMessagingEvents.SHUTDOWN, () => {
      this.sessionActive = false;

      this.sendTo(AdminClientCommands.SESSION_ACTIVITY, this.sessionActivity());
    });
  }

  destruct() { }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onDisconnect(client: Client, force?: boolean) {
    if (force || (this.currentBorState && this.currentBorState.connClientId === client.id)) {
      this.onBorManagerClose();
    }
  }

  onUpdateAttendee(id: string, data: AttendeeBase) {
    if (data.left !== undefined) {
      const room = Object.values(this.inst.model.roomsIndex).find(r =>
        r.meetingAttendees.length && r.meetingAttendees.find(maid => id === maid)
      );

      this.sendTo(AdminClientCommands.ATTENDEE_ACTIVITY, {
        ...this.inst.model.attendeesIndex[id],
        assignedToRoomId: room?.id || '',
        assignedToRoomTitle: room?.title || '',
      });
    }
  }

  onAddAttendee(a: AttendeeBase) {
    this.sendTo(AdminClientCommands.ATTENDEE_ACTIVITY, a);
  }

  @ApmSpan()
  onRemoveAttendee(id: string) {
    this.sendTo(AdminClientCommands.ATTENDEE_REMOVE, { id: id });
  }

  @Socket(AdminServerCommands.BOR_MANAGER_OPEN)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onBorManagerOpen(@client client: Client, data: AdminBorManagerCommand): void {
    if (this.currentBorState.state === BorManagerState.ACTIVE) {
      // send event to the bor api and bor manager that the manager is already active
      this.sendTo(AdminClientCommands.BOR_MANAGER_ACTIVITY, this.currentBorState);

      this.inst.logger.info(`Changing the BOR Manager State to BorManagerState.Active.........`);
      this.inst.server.sendMessage(MeetingMessagingCommands.BOR_MANAGER_STATE_CHANGE, {
        holder: this.currentBorState.currentBorManagerHolder,
        state: BorManagerState.ACTIVE,
      });
      return;
    }

    if (!this.inst.model) {
      this.sendTo(AdminClientCommands.BOR_MANAGER_ACTIVITY, {
        currentBorManagerHolder: '',
        state: BorManagerState.BLOCKED,
        currentBorManagerHolderName: 'Unknown Attendee',
        connClientId: client.id,
      });
      return;
    }

    const attendee = Object.values(this.inst.model.attendeesIndex).find(att => att.userAccountID === data.userAccountID);

    // mark the manager as active
    const currentHolderName = attendee ? `${attendee.firstName} ${attendee.lastName}` : 'Unknown';

    this.currentBorState = {
      currentBorManagerHolder: data.userAccountID,
      state: BorManagerState.ACTIVE,
      currentBorManagerHolderName: currentHolderName,
      connClientId: client.id,
    };
    // send event to notify that the client has successfully opened the bor manager
    this.sendTo(AdminClientCommands.BOR_MANAGER_ACTIVITY, {
      currentBorManagerHolder: data.userAccountID,
      state: BorManagerState.OPENED,
      currentBorManagerHolderName: currentHolderName
    });

    this.inst.logger.info(`Changing the BOR Manager State to BorManagerState.OPENED.........`);
    this.inst.server.sendMessage(MeetingMessagingCommands.BOR_MANAGER_STATE_CHANGE, {
      holder: data.userAccountID,
      state: BorManagerState.OPENED,
    });
  }

  @Socket(AdminServerCommands.BOR_MANAGER_CLOSE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onBorManagerClose(data?: AdminBorManagerCommand): void {
    // only the current holder can close the bor manager
    if (data && this.currentBorState.currentBorManagerHolder !== data.userAccountID) {
      return;
    }

    // after the active Bor Manager is closed, notify other 'pending' managers
    this.sendTo(AdminClientCommands.BOR_MANAGER_ACTIVITY, { ...this.currentBorState, state: BorManagerState.CLOSED });

    this.currentBorState = {
      currentBorManagerHolder: null,
      state: BorManagerState.CLOSED,
      currentBorManagerHolderName: '',
      connClientId: '',
    };

    this.inst.logger.info(`Changing the BOR Manager State to BorManagerState.CLOSED.........`);
    this.inst.server.sendMessage(MeetingMessagingCommands.BOR_MANAGER_STATE_CHANGE, {
      holder: '',
      state: BorManagerState.CLOSED,
    });
  }

  @Socket(AdminServerCommands.BOR_MANAGER_ACTIVITY)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onBorManagerActivity() {
    this.sendTo(AdminClientCommands.BOR_MANAGER_ACTIVITY, this.currentBorState);
  }

  @Get(AdminServerCommands.SESSION_ACTIVITY)
  @ApmTransaction(TransactionType.REQUEST)
  private onRestSessionActivity(@res res: ServerResponse) {
    res.send(200, { data: this.sessionActivity() });
  }

  @Socket(AdminServerCommands.SESSION_ACTIVITY)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onSessionActivity() {
    this.sendTo(AdminClientCommands.SESSION_ACTIVITY, this.sessionActivity());
  }

  private sessionActivity() {
    let attendees: AttendeeBase[] | null = null;
    let removingRooms: string[] = [];

    if (this.inst.model) {
      removingRooms = Object.values(this.inst.model.roomsIndex)
      .filter(room => room.removing)
      .map(room => room.id);

      attendees = Object.values(this.inst.model.attendeesIndex)
      .filter(a => !a.left)
      .map(a => {
        const room = Object.values(this.inst.model.roomsIndex).find(r =>
          r.meetingAttendees.length && r.meetingAttendees.find(maid => a.id === maid)
        );

        return {
          ...a,
          assignedToRoomId: room?.id || '',
          assignedToRoomTitle: room?.title || '',
        };
      });
    }

    return { attendees, removingRooms, online: this.sessionActive };
  }

  @Socket(AdminServerCommands.ROOM_CREATE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomsCreate(rooms: Room[]) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_CREATE, rooms);
  }

  @Socket(AdminServerCommands.ROOM_EDIT)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomEdit(data: AdminCommandRoomAdd) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_EDIT, data);
  }

  @Socket(AdminServerCommands.ROOM_REMOVE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomRemove(data: AdminCommandRoomRemove) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_REMOVE, data);
  }

  @Socket(AdminServerCommands.ROOM_RELOAD)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomReload(data: AdminCommandRoomReload) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_RELOAD, data);
  }

  @Socket(AdminServerCommands.ROOM_ADD_ATTENDEE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomAddAttendee(data: AdminCommandRoomAddAtt) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_ADD_ATTENDEE, data);
  }

  @Socket(AdminServerCommands.ROOM_MOVE_ATTENDEE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomMoveAttendee(data: AdminCommandRoomMoveAtt) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_MOVE_ATTENDEE, data);
  }

  @Socket(AdminServerCommands.ROOM_BRINGBACK_ATTENDEES)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomBringBack(data: AdminCommandRoomBringbackAtts) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_BRINGBACK_ATTENDEES, data);
  }

  @Socket(AdminServerCommands.ROOM_BRINGBACK_PDFS)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomBringBackPdfs(data: AdminCommandBringBackPdfs) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_BRINGBACK_PDFS, data);
  }

  @Socket(AdminServerCommands.ATTENDEES_ASSIGN_TO_ROOM)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onAttendeesAssign(data: AdminCommandAttendeesAssign) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ATTENDEES_ASSIGN_TO_ROOM, data);
  }

  @Socket(AdminServerCommands.ATTENDEES_ASSIGN_REMOVE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onAttendeesAssignRemove(data: AdminCommandAttendeesAssign) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ATTENDEES_ASSIGN_REMOVE, data);
  }

  @Socket(AdminServerCommands.ATTENDEE_MAKE_LEAD)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onAttendeeMakeLead(data: AdminCommandAttendeeMakeLead) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ATTENDEE_MAKE_LEAD, data);
  }

  @Socket(AdminServerCommands.ASSET_UPDATE)
  private onAssetUpdate(data: AdminCommandModifyAsset) {
    this.inst.server.sendMessage(MeetingMessagingCommands.ASSET_UPDATE, data);
  }
}
