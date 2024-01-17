import apm from 'elastic-apm-node/start';
import { RemoteWorkerFactory, TaskQueueOptions, WorkerMessage } from '@container/task-queue';
import { ApmSpan, ApmTransaction, FunctionalDomainType, TransactionType } from '@container/apm-utils';
import BaseModule, { StateInterface } from './BaseModule';
import Client from '../../../utils/Client';
import HashUtils from '../../../utils/HashUtils';
import {
  ClonedRoomIdsCreatedEvent,
  MoveAttendeesEvent,
  RoomAddedEvent,
  RoomCreatedEvent,
  RoomEditedEvent,
  RoomRefreshEvent,
  RoomSettingsChangeEvent,
  SessionEventTypes,
} from '../events/SessionEvents';
import {
  Attendee,
  ClientConnectionAPI,
  RestAPI, Roles, Room,
  ServerConnectionAPI, SessionAudio, SessionComputerAudioOption, UpdateMessageData,
  PdfWorkType, AllowedRoomMove,
  AdminCommandAttendeesAssign,
  RoomConfiguration,
  ErrorCodes, WhiteboardEvent, WhiteboardAction, WhiteboardType
} from '@container/models';
import serverConfig from '../../../utils/serverConfig';
import { MeetingMessagingCommands } from '../events/MessagingAPI';
import { coreApi } from '../../../utils/coreApiClient';
import { forkJoin, of, Observable, from } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PdfWorkMessage } from '../../pdf-app/src/worker/model';
import { DB_COLLECTIONS, defaultDb } from '../../../database';
import { Socket } from '../../../gateway/decorators/method.decorator';
import { client } from '../../../gateway/decorators/argument.decorator';
import { ApplicationLifeCycleState } from '../../../utils/Application';

export class RoomError extends Error {
  constructor(m: string = '') {
    m = m || 'Bad or missing room parameters!';
    super(m);
  }
}

export class RoomMissingError extends RoomError {
  constructor(roomId: string = '') {
    const m = 'No room with id <' + roomId + '>!';
    super(m);
  }
}

export interface RoomState extends StateInterface {
  rooms: Record<keyof Room, any>[];
}

export default class RoomEngine extends BaseModule {
  protected stateCollection = defaultDb().collection(DB_COLLECTIONS.ROOMS_STATE);

  private roomsByName: any = {};
  private closeRoomSchedules: Record<string, NodeJS.Timeout> = {};

  private pdfRemoteWorkerFactory: Promise<RemoteWorkerFactory>;
  private hasPresenter = false;

  private mainRoomPresenterId: Attendee['id'] = '';

  async setup() {
    await super.setup();

    this.inst.updateEngine.registerApprover(this);

    this.inst.server.onSocket(ServerConnectionAPI.BOR_REMOVE, (client, data) =>
      this.onBorRemove(client, data)
    );

    this.inst.server.onSocket(ServerConnectionAPI.BOR_ADD_ATTENDEE,
      (client, data) => this.onBorAddAttendee(client, data)
    );

    this.inst.server.onSocket(ServerConnectionAPI.BOR_BRING_BACK_ATTENDEES,
      (client, data) => this.onBorBringBackAttendees(client, data.id)
    );

    this.inst.server.onSocket(ServerConnectionAPI.BOR_MOVE_ATTENDEES,
      (client, data) => this.onBorMoveAttendees(client, data.roomId, data.attendees)
    );

    this.inst.server.onMessage(MeetingMessagingCommands.ROOM_CREATE, message => this._onMessage(message));
    this.inst.server.onMessage(MeetingMessagingCommands.ROOM_EDIT, message => this._onMessage(message));
    // @FIXME - need to be removed from this.delete an attendee id dependency
    this.inst.server.onMessage(MeetingMessagingCommands.ROOM_REMOVE, message => this._onMessage(message));
    // @FIXME - need to be removed from this.delete an attendee id dependency
    this.inst.server.onMessage(MeetingMessagingCommands.ROOM_RELOAD, message => this._onMessage(message));
    this.inst.server.onMessage(MeetingMessagingCommands.ROOM_ADD_ATTENDEE, message => this._onMessage(message));
    this.inst.server.onMessage(MeetingMessagingCommands.ROOM_MOVE_ATTENDEE, message => this._onMessage(message));
    this.inst.server.onMessage(MeetingMessagingCommands.ROOM_BRINGBACK_ATTENDEES, message => this._onMessage(message));
    this.inst.server.onMessage(MeetingMessagingCommands.ROOM_BRINGBACK_PDFS, message => this._onMessage(message));

    this.inst.server.onMessage(MeetingMessagingCommands.ATTENDEES_ASSIGN_TO_ROOM, message => this._onMessage(message));
    this.inst.server.onMessage(MeetingMessagingCommands.ATTENDEES_ASSIGN_REMOVE, message => this._onMessage(message));

    this.inst.server.onMessage(MeetingMessagingCommands.BOR_MANAGER_STATE_CHANGE, message => this._onMessage(message));

    // this.inst.server.onSocket(
    //   ServerConnectionAPI.ANNOTATIONS_EXPORT,
    //   async (client, data) => {
    //     const room = this.inst.model.roomsIndex[data.roomId];

    //     const worker = (await this.getPdfRemoteWorkerFactory()).create(
    //       `${this.inst.model.meetingID}${data.annotationID}`,
    //       PdfWorkMessage.fromAnyObject({
    //         workType: PdfWorkType.AnnotationExport,
    //         companyId: this.inst.model.sessionSettings.companyId,
    //         meetingId: this.inst.model.meetingID,
    //         annotationId: data.annotationID,
    //         mrid: data.roomId,
    //         roomTitle: room.title,
    //         documentId: data.documentId,
    //         attendeeId: client.data.aid,
    //         boardWidth: this.inst.model.sessionSettings.boardWidth,
    //         boardHeight: this.inst.model.sessionSettings.boardHeight
    //       })
    //     );


    //     worker.observer.on('message', (message: WorkerMessage) => {
    //       this.inst.exportingEngine.sendWorkerStatusToAttendee(message, room.title);

    //       this.inst.exportingEngine.cleanStopWorkerOnDoneMessage(message, worker)
    //         .then(stopped => stopped && this.inst.logger.info('Remote PDF worker shut down. All listeners removed.'))
    //         .catch(error => {
    //           apm.captureError(error);
    //           this.inst.logger.error(`Failed shutting down remote PDF worker. ${error.message}`);
    //         });
    //     });

    //     return worker.run();
    //   }
    // );

    this.inst.eventBus.on(SessionEventTypes.NO_MAIN_PRESENTER, (hasNoPresenter) => this.hasPresenter = !hasNoPresenter);
  }

  async normalizeRooms() {
    const main = this.inst.model.roomsIndex[''];

    main.autoRecording = this.inst.model.sessionSettings.autoRecording;
    main.isGroupChatBlocked = this.inst.model.sessionSettings.lockGroupChat;
    main.isPersonalChatBlocked = this.inst.model.sessionSettings.lockDirectChat;
    main.allowMultiCameras = this.inst.model.sessionSettings.allowMultiCameras;
    main.allowMultiSharings = this.inst.model.sessionSettings.allowMultiSharing;

    for (const room of Object.values(this.inst.model.roomsIndex)) {
      room.allowMultiCameras = this.inst.model.sessionSettings.allowMultiCameras;
      room.allowMultiSharings = this.inst.model.sessionSettings.allowMultiSharing;
    }
    await this.loadState();
  }

  async destruct(code: ErrorCodes) {
    const logger = this.inst.logger;

    if (code === ErrorCodes.SERVER_RESTART) {
      await this.saveState();
    }

    this.roomsByName = {};

    for (const p in this.closeRoomSchedules) {
      clearTimeout(this.closeRoomSchedules[p]);
    }
    this.closeRoomSchedules = {};

    return super.destruct(code);
  }

  @ApmSpan()
  approveAttendeeChange(_, id, data, done) {
    if (data.room !== undefined) {
      if (data.room === '' && !this.hasAnyPresenter) {
        const cid = this.inst.connectionStorage.getClientId(id);
        if (cid) {
          this.inst.server.sendTo(ClientConnectionAPI.HAS_ANY_PRESENTER, false, cid);
        }
      }

      const attendee = this.inst.attendeeStorage.getAttendeeById(id);

      if (attendee && attendee.room === '' && !this.hasAnyPresenter) {
        delete data.room;

        done(data);

        return;
      }
    }
    done(data);
  }

  @ApmSpan()
  async getPdfRemoteWorkerFactory(): Promise<RemoteWorkerFactory> {
    if (!this.pdfRemoteWorkerFactory) {
      const pdfRemoteWorkerFactory = new RemoteWorkerFactory(
        serverConfig.CONFIG.rabbitmq,
        serverConfig.CONFIG.pdfTaskQueue as TaskQueueOptions,
        'PDF_'
      );

      // We want to expose the factory to the class only when it is ready, this is why we wait for it to start,
      // and return after that. Otherwise, race conditions will occur, when calling the function for the first time in a loop.
      this.pdfRemoteWorkerFactory = pdfRemoteWorkerFactory.start().then(() => pdfRemoteWorkerFactory);
    }

    return this.pdfRemoteWorkerFactory;
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  protected onBringBackPdf(ids: string[] | null, attendeeId: string): Promise<string>[] {
    if (!ids?.length) {
      return [];
    }
    if (serverConfig.CONFIG.disableBringBackPDF) {
      this.inst.exportingEngine.sendPdfDisabledMessage();
      return [];
    }
    let rooms = [] as Room[];
    const pdfTaskPromises: Promise<string>[] = [];
    const attendee: Attendee = this.inst.model.attendeesIndex[attendeeId];

    if (!attendee) {
      return [];
    }

    if (ids === null) {
      rooms = Object.values(this.inst.model.roomsIndex).filter(room => room.id !== '');
    } else {
      rooms = ids.map(id => this.inst.model.roomsIndex[id]).filter(room => !!room);
    }

    rooms.forEach(room => {
      // nothing to export from empty rooms
      const msgCode = this.inst.exportingEngine.getNothingToExportMessage(room.id);

      if (msgCode) {
        this.inst.exportingEngine.publishExportStatus(msgCode, room.title);
        pdfTaskPromises.push(Promise.resolve(room.id));
        return;
      }

      // Not using await/async, because typescript requires returning a single Promise.
      // However, here we would like to return an array of Promises, which would have been impossible,
      // if this was an async onBringBackPdf was async.
      const pdfCreatedPromise = this.getPdfRemoteWorkerFactory()
        .then(factory => {
        // send work message
          return factory.start().then(() => {
            return factory.create(
              `${this.inst.model.meetingID}-${room.id}-${attendee.id}`,
              PdfWorkMessage.fromAnyObject({
                workType: PdfWorkType.BringBackPdf,
                companyId: this.inst.model.sessionSettings.companyId,
                meetingId: this.inst.model.meetingID,
                mrid: room.id,
                roomTitle: room.title,
                attendeeId: attendee.id,
                userAccountId: attendee.userAccountID,
                timezoneOffset: (attendee && attendee.timezoneOffset) || '0',
                boardWidth: this.inst.model.sessionSettings.boardWidth,
                boardHeight: this.inst.model.sessionSettings.boardHeight,
                saveAsPdfConfig: { ...room.saveAsPdf },
                wbSizeType: this.inst.model.sessionSettings.howWBHandlesBackgroundImages
              })
            );
          })
        }).then(worker => {
          // make sure we return the promise resolves when the job is done,
          // instead of when the RMQ message is sent (job started)
        const workDonePromise: Promise<string> = new Promise((resolve, reject) => {
          worker.observer.on('message', (message: WorkerMessage) => {
            this.inst.exportingEngine.sendWorkerStatusToAttendee(message, room.title);

            this.inst.exportingEngine.cleanStopWorkerOnDoneMessage(message, worker)
              .then(stopped => stopped && this.inst.logger.info('Remote PDF worker shut down. All listeners removed.'))
              .catch(error => {
                apm.captureError(error);
                this.inst.logger.error(`Failed shutting down remote PDF worker. ${error.message}`);
              });

            if (this.inst.exportingEngine.isJobDone(message)) {
              resolve(room.id);
            }

            if (this.inst.exportingEngine.isJobFailed(message)) {
              reject(new Error('Bring back PDF failed.'));
            }
          });
        });

        worker.run();

        return workDonePromise;
      }); // Promise chain ends

      pdfTaskPromises.push(pdfCreatedPromise);
    }); // forEach ends

    return pdfTaskPromises;
  }

  @ApmSpan()
  createLocalBORUpdateDataV2(content: any) {
    const updateData = {
      id: content.id,
      bringBackChat: content.bringBackChat,
      bringBackNotes: content.bringBackNotes,
      bringBackWhiteboard: content.bringBackWhiteboard,
      title: content.name || content.BORoomName,
      nameRecording: content.borRecordName,
      autoRecording: content.recordRoom,
      autoClose: content.closeTime,
      closeMethod: content.closeMethod,
      lockNoteboard: content.lockNoteboard,
      allowRoomMove: content.allowRoomMove,
      isGroupChatBlocked: content.lockChat,
      isPersonalChatBlocked: content.lockDirectChat,
      isTestRoom: undefined,
      roomConfiguration: content.roomConfiguration,
      allowAttendeesSelfExitFromRoom: content.allowAttendeesSelfExitFromRoom,
      allowAttendeesToChangeGroupWBPage: content.allowAttendeesToChangeGroupWBPage
    };

    if (content.roomConfiguration) {
      const isTestRoom = content.roomConfiguration === RoomConfiguration.TESTROOM;

      updateData.allowRoomMove = isTestRoom ? AllowedRoomMove.AssignedAttendees : updateData.allowRoomMove;
      updateData.isGroupChatBlocked = isTestRoom || updateData.isGroupChatBlocked;
      updateData.isPersonalChatBlocked = isTestRoom || updateData.isPersonalChatBlocked;
      updateData.isTestRoom = isTestRoom;
    }

    return updateData;
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  addOrUpdateBORs(updateData: any[]) {
    const updatedRooms = [];
    updateData.forEach(data => {
      const room = this.inst.model.roomsIndex[data.id];
      if (room) {
        const partialRoomSettings = this.createBORSettingsPatch(data, room);
        if (Object.keys(partialRoomSettings).length > 0) {
          this.update(partialRoomSettings, true);
          updatedRooms.push(partialRoomSettings);
        } else {
          // We don't have settings to update, but the layout might have updated
          // so we need to signal to the client to fetch new layout
          updatedRooms.push({id: room.id});
        }
      } else {
        this.add(data, true);
        updatedRooms.push(data);
      }
      this.addSessionAttendees(data.meetingAttendees);
    });

    this.inst.eventBus.emit(RoomRefreshEvent.type, updatedRooms);
    this.inst.server.sendTo(ClientConnectionAPI.BOR_REFRESH_ROOMS, updatedRooms);
  }

  @ApmSpan()
  addSessionAttendees(attendees) {
    if (!attendees || !Array.isArray(attendees)) {
      return;
    }
    const sessionAttendeeSet = new Set(this.inst.model.roomsIndex[''].meetingAttendees);
    attendees.forEach(attendee => {
      if (!sessionAttendeeSet.has(attendee.id)) {
        this.inst.model.roomsIndex[''].meetingAttendees.push(attendee);
      }
    });
  }

  @ApmSpan()
  createBORSettingsPatch(settings: any, room: Room) {
    const partialRoomSettings = {};
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined) {
        continue;
      }

      if (value !== room[key]) {
        partialRoomSettings[key] = value;
      }
    }

    if (Object.keys(partialRoomSettings).length > 0) {
      partialRoomSettings['id'] = settings.id;
    }

    return partialRoomSettings;
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRemoveBor(roomIds: string[], attendeeId = '') {
    this.remove(roomIds, attendeeId || this.inst.model.sessionSettings.hostID)
    .then(({removedIds, failedIds}) => {
      if (failedIds.length) {
        this.inst.logger.error(`Could not close BORs.`, failedIds);

        this.sendToMainPresenters(ClientConnectionAPI.NOTIFY_USER, {
          msg: 'Failed closing one or more rooms.',
          type: 'error'
        });
      }

      if (removedIds.length) {
        this.inst.server.sendTo(ClientConnectionAPI.BOR_REMOVE_ALL, { roomIds: removedIds });
      }
    })
    .catch(error => {
      const custom = { roomIds };
      apm.captureError(error, { custom });
      this.inst.logger.error(`Could not close BORs. ${error.message}`, custom);

      this.sendToMainPresenters(ClientConnectionAPI.NOTIFY_USER, {
        msg: 'Failed closing one or more rooms.',
        type: 'error'
      });
    });
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  protected onBorBringBackAttendees(client: Client, roomId: string = '') {
    if (client) {
      const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];

      if (!this.isMainRoomPresenter(a)) {
        this.inst.logger.info(
          `Client (aid: ${a.id}) tried to empty BOR`,
          {fullName: a.fullName, role: a.role, room: a.room}
        );
        return;
      }
    }

    if (!roomId) {
      // we need to empty all rooms
      this.emptyRoom();
    } else {
      const room = this.inst.model.roomsIndex[roomId];
      if (!room || room.removing) {
        return;
      }
      this.emptyRoom(room);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  protected onBorMoveAttendees(client: Client | null, roomId: string, attendees?: string[]) {
    if (client) {
      const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];

      if (!this.isMainRoomPresenter(a)) {
        this.inst.logger.info(
          `Client (aid: ${a.id}) tried to move attendees to BOR`,
          {fullName: a.fullName, role: a.role, room: a.room}
        );
        return;
      }
    }

    const room = this.inst.model.roomsIndex[roomId];
    if (!room || room.removing) {
      return;
    }

    attendees = attendees || room.meetingAttendees;

    if (attendees.length) {
      // @fixme hasBeenUsed is part of the public model. Here it is updated but clients are not notified
      room.hasBeenUsed = true;
      this.moveToRoom(attendees, roomId);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onBorRemove(client: Client, data: {id: string}) {
    // @fixme make some checks about client permissions

    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_REMOVE_IN_PROGRESS, data);

    this.onRemoveBor(
      (data && data.id ? [ data.id ] : Object.keys(this.inst.model.roomsIndex).filter(id => id)),
      client.data.aid
    );
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  protected onBorAddAttendee(client: Client | null, data: any) {
    if (client) {
      const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];
      if (!this.isMainRoomPresenter(a) && !this.canMoveToRoom(data.toRoom, data.id)) {
        this.inst.logger.info(
          'Client (aid: ' + a.id + ') tried to move attendees to BOR',
          {fullName: a.fullName, role: a.role, room: a.room}
        );
        return;
      }
    }

    const targetRoom = this.inst.model.roomsIndex[data.toRoom];

    // throw error if the room does not exist
    if (!targetRoom) {
      throw new RoomMissingError(data.toRoom);
    }
    if (targetRoom.removing) {
      return;
    }

    // @fixme hasBeenUsed is part of the public model. Here it is updated but clients are not notified
    targetRoom.hasBeenUsed = true;
    this.moveToRoom([data.id], data.toRoom);
  }

  // TODO: consider moving the assigned attendees outside room object.
  //       Right now every attendee receives information about all meeting room assignments
  @ApmTransaction(TransactionType.WS_REQUEST)
  protected onBorAttendeesAssign(data: AdminCommandAttendeesAssign) {
    const assignAttendeeMap = new Map<string/* attendee id */, string/* room id */>();
    Object.values(this.inst.model.roomsIndex).forEach(r =>
      r.meetingAttendees.forEach(attId => assignAttendeeMap.set(attId, r.id))
    );

    data.attendeesList.forEach(attendeeId => {
      const roomId = assignAttendeeMap.get(attendeeId);
      const attendeeRoom = this.inst.model.roomsIndex[roomId];

      if (attendeeRoom && roomId && roomId !== data.borId) {
        const list = attendeeRoom.meetingAttendees.filter(id => id !== attendeeId);

        this.updateRoom(roomId, { meetingAttendees: list });
      }

      if (!attendeeRoom) {
        this.inst.logger.warn(`Attendee (${attendeeId}) is assigned to missing room (${roomId})`);
      }

      assignAttendeeMap.delete(attendeeId);
    });

    const room = this.inst.model.roomsIndex[data.borId];

    if (!room) {
      this.inst.logger.error(`Room (${data.borId}) is missing.`, { attendeesList: data.attendeesList });
      return;
    }

    const clearDataList = data.attendeesList.filter(id => !assignAttendeeMap.has(id));

    if (clearDataList.length) {
      const list = new Set(room.meetingAttendees.concat(clearDataList));
      this.updateRoom(room.id, { meetingAttendees: Array.from(list) });
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  protected onBorAttendeesAssignRemove(data: AdminCommandAttendeesAssign) {
    const room: Room = this.inst.model.roomsIndex[data.borId];

    if (!room) {
      this.inst.logger.error(`Room (${data.borId}) is missing.`, { attendeesList: data.attendeesList });
      return;
    }

    this.updateRoom(room.id, {
      meetingAttendees: room.meetingAttendees.filter(id => !data.attendeesList.includes(id))
    });
  }

  /**
   * this function is checking for a presenter in the session, even if the presenter is scratched (left === true), it will return true
   */
  public hasMainRoomPresenter(): boolean {
    return !!this.getMainRoomPresenter();
  }

  public getMainRoomPresenter(): Attendee | null {
    const mainPresenter = this.inst.model.attendeesIndex[this.mainRoomPresenterId];

    if (this.inst.roomEngine.isMainRoomPresenter(mainPresenter)) {
      return mainPresenter;
    }

    for (const id in this.inst.model.attendeesIndex) {
      const attendee = this.inst.model.attendeesIndex[id];

      if (this.isMainRoomPresenter(attendee)) {
        this.mainRoomPresenterId = attendee.id;

        return attendee;
      }
    }

    return null;
  }

  public hasActiveMainRoomPresenter(): boolean {
    // the difference here is that the presenter should be in the session - left === false
    return this.inst.getAllAttendeeIds().find((aid) => this.inst.model.attendeesIndex[aid] &&
      !this.inst.model.attendeesIndex[aid].left &&
      this.isMainRoomPresenter(this.inst.model.attendeesIndex[aid])) !== undefined;
  }


  public isHost(attendee: Attendee): boolean {
    return attendee && (attendee.role === Roles.HOST);
  }

  public isCoHost(attendee: Attendee): boolean {
    return attendee && (attendee.role === Roles.COHOST);
  }

  public isLead(attendee: Attendee): boolean {
    return attendee && (attendee.role === Roles.LEAD);
  }

  public isMainRoomPresenter(attendee: Attendee): boolean {
    return this.isRoomPresenter(attendee, '') || this.isHost(attendee) || this.isCoHost(attendee);
  }

  public isRoomPresenter(attendee: Attendee | null, roomId: string): boolean {
    // TODO: see where we set hasBaton = false for the presenter
    return attendee && attendee.room === roomId && attendee.hasBaton;
  }

  public getRoomById(roomId: string): Room {
    return this.inst.model.roomsIndex[roomId];
  }

  public getAllRooms(): Record<string, Room> {
    return this.inst.model.roomsIndex;
  }

  @ApmSpan()
  async loadRooms(): Promise<void> {
    const [ {data: roomList}, {data: assignMap} ] = await Promise.all([
      coreApi.get<any>(
        `${RestAPI.BORS}/${encodeURIComponent(this.inst.model.meetingID)}`
      ),
      coreApi.get(
        `${RestAPI.GET_ASSIGNED_ATTENDEES}/${encodeURIComponent(this.inst.model.meetingID)}`
      )
    ]);

    this.initRooms(roomList, assignMap);
  }

  @ApmSpan()
  private initRooms(
    roomList: Record<string, any>[] & {errNo: number, message: string},
    assignMap: Record<Room['id'], any>
  ): void {
    const updateRoomsData = [];
    const currentRooms = {};

    if (!roomList || (roomList.errNo || roomList.message)) {
      throw new Error(`Session rooms cannot be loaded because ${roomList} is missing`);
    }

    this.inst.logger.debug('Session rooms were loaded successfully');

    Object.keys(this.inst.model.roomsIndex).forEach(id => currentRooms[id] = 1);

    let room: Room;
    let pack;
    roomList.forEach((roomData) => {
      delete currentRooms[roomData.boRoomId];
      pack = {
        id: roomData.boRoomId,

        bringBackPdfs: roomData.bringBackPdfs,
        bringBackChat: roomData.bringBackChat,
        bringBackNotes: roomData.bringBackNotes,
        bringBackWhiteboard: roomData.bringBackWhiteboard,

        autoRecording: this.inst.model.sessionSettings?.autoRecording || false,

        isGroupChatBlocked: this.inst.model.sessionSettings?.lockGroupChat || false,
        isPersonalChatBlocked: this.inst.model.sessionSettings?.lockDirectChat || false,
      };
      if (pack.id !== '') {
        const isTestRoom = roomData.roomConfiguration === RoomConfiguration.TESTROOM;
        pack = {
          ...pack,
          title: roomData.name,

          nameRecording: roomData.borRecordName,
          autoRecording: roomData.recordRoom,

          autoClose: roomData.closeTimer,

          closeMethod: roomData.closeMethod,
          isSessionRoom: roomData.isSessionRoom,
          isTestRoom: isTestRoom,
          allowRoomMove: isTestRoom ? AllowedRoomMove.AssignedAttendees : roomData.allowRoomMove,

          isGroupChatBlocked: roomData.lockChat,
          isPersonalChatBlocked: roomData.lockDirectChat,

          roomConfiguration: roomData.roomConfiguration,

          lockNoteboard: roomData.lockNoteboard,
          leadId: roomData.leadId,
          allowAttendeesSelfExitFromRoom: roomData.allowAttendeesSelfExitFromRoom,
          allowAttendeesToChangeGroupWBPage: roomData.allowAttendeesToChangeGroupWBPage,

          meetingAttendees: (assignMap && assignMap[pack.id]) || [],
        };
      }

      room = this.inst.model.roomsIndex[pack.id];

      if (room) {
        let updatePack;
        Object.keys(pack).forEach((key: keyof Room) => {
          if (pack[key] !== room[key]) {
            if (!updatePack) {
              updatePack = { id: pack.id };
            }
            updatePack[key] = pack[key];
          }
        });

        if (updatePack) {
          this.update(updatePack, true);
          updateRoomsData.push(updatePack);
        }
      } else {
        this.add(pack, true);

        updateRoomsData.push(this.inst.model.roomsIndex[pack.id]);
      }
    });

    this.inst.eventBus.emit(RoomRefreshEvent.type, updateRoomsData);

    if (this.inst.lifeCycleState !== ApplicationLifeCycleState.RUNNING) {
      return;
    }

    this.inst.server.sendTo(ClientConnectionAPI.BOR_REFRESH_ROOMS, updateRoomsData);

    const roomIds = Object.keys(currentRooms);
    if (!roomIds?.length) {
      return;
    }

    this.remove(roomIds, this.inst.model.sessionSettings.hostID)
    .then(({removedIds, failedIds}) => {
      if (failedIds.length) {
        this.inst.logger.error(`Synchronization rooms close fails`, roomIds);
      }

      if (removedIds.length) {
        this.inst.server.sendTo(ClientConnectionAPI.BOR_REMOVE_ALL, { roomIds: removedIds });
      }
    })
    .catch(error => {
      const custom = { roomIds };
      apm.captureError(error, { custom });
      this.inst.logger.error(`Synchronization rooms close fails. ${error.message}`, custom);
    });
  }

  public adds(sources: any[]) {
    sources.forEach(source => {
      try {
        this.add(source, true);
      } catch (err) {
        apm.captureError(err);
        this.inst.logger.error(err.message);
      }
    });
  }

  @ApmSpan()
  public getPushToTalkSetting(roomId: string): boolean {
    // BORs are always open mic - #827 - Melissa's last comment
    if (roomId !== '') {
      return false;
    }

    if (!this.inst.model.sessionSettings || !this.inst.model.sessionSettings.audio || this.inst.model.sessionSettings.audio.length < 2) {
      return true;
    }
    if (this.inst.model.sessionSettings.audio[0] === SessionAudio.COMPUTER_AND_PHONE) {
      return false;
    }
    return this.inst.model.sessionSettings.audio[1] === SessionComputerAudioOption.PPT_ON;
  }

  private getUniqueName(ttl): string {
    while (this.roomsByName[ttl]) {
      ttl = ttl + '*';
    }

    return ttl;
  }

  @ApmSpan()
  public add(conf: any, silent: boolean = false) {
    let ttl;

    // TODO: see where we use add and use only one type name | title
    conf.name = conf.name || conf.title;

    if (!conf.name || !(ttl = conf.name.trim())) {
      this.inst.logger.warn(`Room ${conf.id} has no name. Generate system name`);
      conf.name = 'Nameless Room';
    }

    if (this.roomsByName[ttl]) {
      this.inst.logger.warn(`Room ${conf.id} duplicated room title <${ttl}>. Renaming the room!`);
      ttl = this.getUniqueName(ttl);
    }

    if (!conf.hasOwnProperty('id')) {
      conf.id = HashUtils.md5(ttl);
    }

    let mainRoomAllowMultiSharing = this.inst.model.sessionSettings.allowMultiSharing;
    let mainRoom: Room;
    if (this.inst.model.roomsIndex['']) {
      mainRoomAllowMultiSharing = this.inst.model.roomsIndex[''].allowMultiSharings;
      mainRoom = this.inst.model.roomsIndex[''];
    } else {
      mainRoom = new Room(); // we need this to get the default values
    }
    if (!this.inst.model.sessionSettings.allowRecording) {
      conf.autoRecording = false;
    }

    this.roomsByName[ttl] = conf.id;
    this.inst.model.roomsIndex[conf.id] = new Room({
      id: conf.id,
      title: ttl,

      isGroupChatBlocked: conf.isTestRoom ? true : conf.isGroupChatBlocked,
      isPersonalChatBlocked: conf.isTestRoom ? true : conf.isPersonalChatBlocked,

      lockNoteboard: conf.isTestRoom ? true : conf.lockNoteboard,

      allowMultiCameras: this.inst.model.sessionSettings.allowMultiCameras,
      allowMultiSharings: mainRoomAllowMultiSharing,
      allowRoomMove: conf.isTestRoom ? AllowedRoomMove.AssignedAttendees : conf.allowRoomMove,


      autoRecording: conf.autoRecording,
      nameRecording: conf.nameRecording,

      autoClose: conf.autoClose,

      pushToTalk: this.getPushToTalkSetting(conf.id),
      enabledAllMic: conf.isTestRoom ? false : true,
      enableAllCams: conf.isTestRoom ? true : mainRoom.enableAllCams,
      saveAsPdf: {
        chat: conf.bringBackChat ,
        whiteboard: conf.bringBackWhiteboard,
        notes: conf.bringBackNotes
      },

      closeMethod: conf.closeMethod || 0,
      isSessionRoom: conf.isSessionRoom || false,
      meetingAttendees: conf.meetingAttendees || [],
      cameraMirroring: this.inst.model.sessionSettings.cameraMirroring,
      isTestRoom: conf.isTestRoom,
      currentLeadId: conf.leadId,
      assignedLeadId: conf.leadId,
      roomConfiguration: conf.roomConfiguration,
      allowAttendeesSelfExitFromRoom: conf.allowAttendeesSelfExitFromRoom,
      allowAttendeesToChangeGroupWBPage: conf.allowAttendeesToChangeGroupWBPage
    });

    this.inst.eventBus.emit(RoomAddedEvent.type, conf.id);

    if (!silent) {
      this.inst.server.sendTo(ClientConnectionAPI.BOR_ADD, this.inst.model.roomsIndex[conf.id]);
    }
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_ADD, { ...this.inst.model.roomsIndex[conf.id] });
  }

  public updateRoom(id: string, data: Partial<Room>, silent: boolean = false) {
    data.id = id;

    this.update(data, silent);
  }

  @ApmSpan()
  public update(conf: any, silent: boolean = false) {
    if (!conf.hasOwnProperty('id')) {
      throw new RoomError();
    }

    const room = this.inst.model.roomsIndex[conf.id];
    if (!room) {
      throw new RoomError('No room with id ' + conf.id);
    }

    let ttl = room.title;
    if (conf.hasOwnProperty('title')) {
      conf.title = conf.title.trim();
      ttl = conf.title;

      delete this.roomsByName[room.title];
      this.roomsByName[ttl] = conf.id;
    }

    if (conf.hasOwnProperty('bringBackChat')) {
      this.inst.model.roomsIndex[conf.id].saveAsPdf.chat = conf.bringBackChat;
    }

    if (conf.hasOwnProperty('bringBackNotes')) {
      this.inst.model.roomsIndex[conf.id].saveAsPdf.notes = conf.bringBackNotes;
    }

    if (conf.hasOwnProperty('bringBackWhiteboard')) {
      this.inst.model.roomsIndex[conf.id].saveAsPdf.whiteboard = conf.bringBackWhiteboard;
    }

    if (conf.hasOwnProperty('isTestRoom') && conf.isTestRoom) {
      room.isGroupChatBlocked = true;
      room.isPersonalChatBlocked = true;
      room.allowRoomMove = AllowedRoomMove.AssignedAttendees;
    }
    if (!this.inst.model.sessionSettings.allowRecording) {
      conf.autoRecording = false;
    }

    Object.assign(this.inst.model.roomsIndex[conf.id], conf);

    this.inst.eventBus.emit(RoomEditedEvent.type, new RoomEditedEvent(conf.id, conf));
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_PARTIAL_EDIT, conf);
    this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_EDIT, this.inst.model.roomsIndex[conf.id]);

    if (!silent) {
      this.inst.server.sendTo(ClientConnectionAPI.BOR_UPDATE, conf);
    }
  }

  public async resetRooms() {
    Object.values(this.inst.model.roomsIndex).forEach(room => {
      this.updateRoom(room.id, {
        hideBottomPane: null,
        allowMultiCameras: this.inst.model.sessionSettings.allowMultiCameras,
        allowMultiSharings: this.inst.model.sessionSettings.allowMultiSharing,
        pushToTalk: this.getPushToTalkSetting(room.id),
        cameraMirroring: this.inst.model.sessionSettings.cameraMirroring,
      }, true);
    });

    await this.loadRooms();
  }

  getAllAttendeeIdsForRoom(rid: Room['id'], addMainRoomPresenters = false): Array<Attendee['id']> {
    const attendees = new Set<Client['id']>();

    if (addMainRoomPresenters) {
      const hostAttendee = this.inst.attendeeStorage.getAttendeeById(this.inst.model.sessionSettings.hostID);

      if (hostAttendee) {
        attendees.add(hostAttendee.id);
      }

      // do this only if room is different than main room because we expect presenters to be there anyway.
      const mainRoomAttendees = this.inst.attendeeStorage.getAttendeesByRole(Roles.COHOST);

      for (const [, attendee] of mainRoomAttendees) {
        attendees.add(attendee.id);
      }
    }

    const targetRoomAttendees = this.inst.attendeeStorage.getAttendeeMapByRoomId(rid);
    for (const [, attendee] of targetRoomAttendees) {
      attendees.add(attendee.id);
    }
    return [...attendees];
  }

  getAttendeesForRoom(rid: Room['id'], addMainRoomPresenters = false): Record<Attendee['id'], Attendee> {
    const map = {};

    for (const aid in this.inst.model.attendeesIndex) {
      const attendee = this.inst.model.attendeesIndex[aid];
      if (
        attendee && (
          (attendee.room === rid) ||
          (addMainRoomPresenters && this.isMainRoomPresenter(attendee))
        )
      ) {
        map[attendee.id] = attendee;
      }
    }

    return map;
  }

  hasAnyInRoom(rid: string, miss: string = ''): boolean {
    const attendees = this.inst.attendeeStorage.getAttendeeMapByRoomId(rid);

    for (const [, attendee] of attendees) {
      if ((attendee.role !== Roles.GHOST && attendee.id !== miss && !attendee.left)) {
        return true;
      }
    }
    return false;
  }

  public getRoomCoPresenterId(rid: string): string {
    const attendees = this.inst.attendeeStorage.getAttendeeMapByRoomId(rid);

    for (const [, attendee] of attendees) {
      if (attendee.hasBaton && !attendee.left && attendee.role !== Roles.HOST) {
        return attendee.id;
      }
    }
    return null;
  }

  /**
   * it is looking for baton that is online and is not host
   */
  getRoomCoPresenter(id: string): Attendee | null {
    const attendees = this.inst.attendeeStorage.getAttendeeMapByRoomId(id);
    for (const [, attendee] of attendees) {
      if (attendee.hasBaton && !attendee.left && attendee.role !== Roles.HOST) {
        return attendee;
      }
    }
    return null;
  }

  /**
   * it is looking in the room for host that still in online. If fail then search for and return a room baton.
   */
  getRoomBaton(id: string, roomFocus = true): Attendee | null {
    const host = this.inst.model.attendeesIndex[this.inst.model.sessionSettings.hostID];
    if (host && !host.left && (!roomFocus || host.room == id)) {
      return host;
    }
    return this.getRoomCoPresenter(id);
  }

  @ApmSpan()
  sendToRoom(rid: Room['id'], method: string, data: any, includeHosts = false) {
    const cids = new Set<Client['id']>();

    if (includeHosts) {
      const hostAttendee = this.inst.attendeeStorage.getAttendeeById(this.inst.model.sessionSettings.hostID);

      if (hostAttendee) {
        const cid = this.inst.connectionStorage.getClientId(hostAttendee?.id);
        cids.add(cid);
      }

      const mainRoomAttendees = this.inst.attendeeStorage.getAttendeesByRole(Roles.COHOST);

      for (const [, attendee] of mainRoomAttendees) {
        const cid = this.inst.connectionStorage.getClientId(attendee?.id);
        cids.add(cid);
      }
    }

    const attendees = this.inst.attendeeStorage.getAttendeeMapByRoomId(rid);

    for (const [_, attendee] of attendees) {
      const cid = this.inst.connectionStorage.getClientId(attendee?.id);

      if (cid && attendee && !attendee.left) {
        cids.add(cid);
      }
    }

    this.inst.server.sendTo(method, data, cids);
  }

  @ApmSpan()
  sendToRoomWithFallback(rid: Room['id'], method: ClientConnectionAPI, data: any) {
    // sends messages target room
    // fallbacks to other hosts / co-hosts if no hosts in target room
    const clientsMap = {
      targetRoom: [],
      restRooms: []
    };

    let hasRoomHosts = false;

    const attendees = this.inst.attendeeStorage.getAttendees();

    for (const [_, attendee] of attendees) {

      if (attendee && !attendee.left) {
        const cid = this.inst.connectionStorage.getClientId(attendee.id);

        if (attendee.room === rid) {
          clientsMap.targetRoom.push(cid);

          if (this.isHost(attendee) || this.isCoHost(attendee)) {
            hasRoomHosts = true;
            continue;
          }
        }

        if (this.isHost(attendee) || this.isCoHost(attendee)) {
          clientsMap.restRooms.push(cid);
        }
      }
    }

    const cids = hasRoomHosts ? clientsMap.targetRoom : clientsMap.targetRoom.concat(clientsMap.restRooms);

    this.inst.server.sendTo(method, data, cids);
  }

  @ApmSpan()
  sendToRoomMainPresentersWithFallback(rid: Room['id'], method: ClientConnectionAPI, data: any) {
    // sends message target room presenters
    // fallbacks to other hosts / co-hosts if no hosts in target room
    const clientsMap: Record<string, Client['id'][]> = {
      targetRoom: [],
      restRooms: []
    };

    const attendees = this.inst.attendeeStorage.getAttendees()

    for (const [_, attendee] of attendees) {

      if (!attendee || attendee.left) {
        continue; // should skip missing attendee
      }

      if (!((attendee.role === Roles.HOST || attendee.role === Roles.COHOST))) {
        continue; // should skip if user role is incorrect
      }

      const cid = this.inst.connectionStorage.getClientId(attendee?.id);

      if (attendee.room === rid) {
        clientsMap.targetRoom.push(cid);
        continue;
      }

      clientsMap.restRooms.push(cid);
    }

    const cids = (clientsMap.targetRoom.length && clientsMap.targetRoom || clientsMap.restRooms);

    this.inst.server.sendTo(method, data, cids);
  }

  @ApmSpan()
  sendToRooms(rooms: any[], method: string, data: any, addMainRoomPresenters: boolean = false) {
    for (const room of rooms) {
      data.to = room.roomId;
      this.sendToRoom(room.roomId, method, data, addMainRoomPresenters);
    }
  }

  @ApmSpan()
  sendToMainPresenters(method: ClientConnectionAPI, data: any) {
    const roles = [Roles.HOST, Roles.COHOST, Roles.PRESENTER];
    const cids = [];

    for (const role of roles) {
      const attendees = this.inst.attendeeStorage.getAttendeesByRole(role);

      for (const [_, attendee] of attendees) {
        if (role === Roles.PRESENTER && attendee.room !== '') {
          continue;
        }

        cids.push(this.inst.connectionStorage.getClientId(attendee.id));
      }
    }
    this.inst.server.sendTo(method, data, cids);
  }

  protected getAllRoomIds(): Array<string> {
    return Object.keys(this.inst.model.roomsIndex).filter((roomId) => roomId !== '' && !!this.inst.model.roomsIndex[roomId]);
  }

  @ApmSpan()
  getAnyPresenterId(onlineOnly = false, checkStatic = false): string {
    let attendee = this.inst.model.attendeesIndex[this.inst.model.sessionSettings.hostID];
    // in case host is phone or ghost
    if (attendee && (attendee.role !== Roles.HOST && attendee.role !== Roles.COHOST)) {
      attendee = null;
    }
    if (attendee && attendee.left && onlineOnly) {
      attendee = null;
    }

    if (!attendee) {
      const role = (checkStatic ? 'staticRole' : 'role');

      attendee = Object.values(this.inst.model.attendeesIndex).find(att =>
        (att.role !== Roles.PHONE && (!onlineOnly || !att.left) && (att[role] === Roles.PRESENTER || att[role] === Roles.COHOST))
      );
    }
    return (attendee ? attendee.id : '');
  }

  getAnyPresenter(): Attendee {
    return this.inst.model.attendeesIndex[this.getAnyPresenterId()];
  }

  getAnyOnlinePresenter() {
    return this.inst.model.attendeesIndex[this.getAnyPresenterId(true)];
  }

  getCohostCandidate(): Attendee | undefined {
    return Object.values(this.inst.model.attendeesIndex)
      .filter(attendee => attendee.staticRole === Roles.PRESENTER && attendee.role !== Roles.PHONE && !attendee.left)
      // Sort by room id, as we need to consider presenters in the main room before presenters in BORs
      // main room id is always '', while BOR ids are valid UUIDs
      .sort((att1, att2) => att1.room.length - att2.room.length)[0];
  }

  get hasAnyPresenter(): boolean {
    return this.hasPresenter;
  }

  @ApmSpan()
  protected emptyRoom(room?: Room) {
    const ids = [];

    for (const a of Object.values(this.inst.model.attendeesIndex)) {
      if (a && (
        (room !== undefined && a.room == room.id) ||
        (room === undefined && a.room != '')
      )) {
        ids.push(a.id);
      }
    }

    this.moveToRoom(ids, '');
  }

  public emptyAllRooms() {
    return this.emptyRoom();
  }

  @ApmSpan()
  protected moveToRoom(aids: Array<Attendee['id']>, rid: Room['id']) {
    const room = this.getRoomById(rid);

    if (!room) {
      return;
    }

    const movedAids = new Set<Attendee['id']>();
    const packages = [];
    const affectedRooms = new Set<Room['id']>();

    for (const aid of aids) {
      const attendee = this.inst.model.attendeesIndex[aid];

      if (!attendee || attendee.room === rid || attendee.role === Roles.GHOST || movedAids.has(aid)) {
        continue;
      }

      affectedRooms.add(attendee.room);
      movedAids.add(aid);
      packages.push(new UpdateMessageData(aid, { room: rid }));
    }

    if (!movedAids.size) {
      return;
    }

    if (room.autoClose && !this.closeRoomSchedules[rid]) {
      this.inst.logger.debug(`Auto close timer is started for room ${room.id}`, room.autoClose);

      this.inst.sendToAttendees(movedAids, ClientConnectionAPI.NOTIFY_USER, {
        msg: `The room will be automatically closed after ${room.autoClose} minutes.`
      });

      this.closeRoomSchedules[rid] = setTimeout(() => this.onCloseRoomInSchedule(rid), room.autoClose * 60000);
    }

    // we use update engine instead
    this.inst.updateEngine.updateAttendees(null, packages).then(_ => {
      affectedRooms.delete(rid);
      this.inst.batonEngine.setupBaton(rid);

      // we should also update all rooms that we move attendees from
      for (const arid of affectedRooms.values()) {
        this.inst.batonEngine.setupBaton(arid);
      }

      this.inst.eventBus.emit(MoveAttendeesEvent.type, {movedAids, rid, affectedRooms});
    });
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private onCloseRoomInSchedule(roomId: string) {

    const room = this.getRoomById(roomId);
    if (!room) {
      clearTimeout(this.closeRoomSchedules[roomId]);
      delete this.closeRoomSchedules[roomId];
      return;
    }

    this.inst.logger.debug('Scheduled room closed', roomId);

    this.remove([ roomId ]).then(({removedIds, failedIds}) => {
      if (failedIds.length) {
        this.inst.logger.error(`Automate room (${room.id}) close fail`);

        this.inst.server.sendTo(ClientConnectionAPI.NOTIFY_USER, {
          msg: `Failed closing room: "${room.title}"`,
          type: 'error'
        });
      }

      if (removedIds.length) {
        this.inst.server.sendTo(ClientConnectionAPI.BOR_REMOVE_ALL, { roomIds: removedIds });
        this.inst.server.sendTo(ClientConnectionAPI.NOTIFY_USER, {
          msg: `The room was automatically closed after ${room.autoClose} minutes.`,
          type: 'info'
        });
      }
    }).catch(err => {
      apm.captureError(err);
      this.inst.logger.error(`Automated room (${roomId}) close failed. ${err.message}`);

      this.inst.server.sendTo(ClientConnectionAPI.NOTIFY_USER, {
        msg: `Failed closing room: "${room.title}"`,
        type: 'error'
      });
    })
    .finally(() => {
      clearTimeout(this.closeRoomSchedules[roomId]);
      delete this.closeRoomSchedules[roomId];
    });
  }

  @ApmSpan()
  private prepareToRemove(ids: string[]): {borsWithExport: string[]; borsWithoutExport: string[]} {
    const borsWithoutExport = [];
    const borsWithExport = [];

    ids.forEach(id => {
      if (!this.inst.model.sessionSettings.allowAutoPdfBringBack || this.inst.exportingEngine.getNothingToExportMessage(id)) {
        borsWithoutExport.push(id);
      } else {
        borsWithExport.push(id);
      }

      const room = this.inst.model.roomsIndex[id];

      if (room) {
        this.inst.roomEngine.updateRoom(id, { removing: true });
        this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_REMOVE_IN_PROGRESS, { id });

        this.emptyRoom(room);
      }
    });

    return {borsWithoutExport, borsWithExport};
  }

  @ApmSpan()
  private async remove(ids: string[] | null, attId?: string): Promise<{removedIds: string[]; failedIds: string[]}> {
    if (!Array.isArray(ids) || !ids.length) {
      return {removedIds: [], failedIds: []};
    }

    const {borsWithExport, borsWithoutExport} = this.prepareToRemove(ids);
    let removedIds = [];
    const failedIds = [];

    try {
      const removed = await this._remove(borsWithoutExport, false);
      removedIds = removedIds.concat(removed);
    } catch (e) {
      this.failedToRemoveRooms(borsWithoutExport);
      failedIds.push(...borsWithoutExport);
    }

    if (borsWithExport.length) {
      const successfullyExported = new Set<string>();
      let requests: Observable<string>[] = [];
      try {
        requests = this.onBringBackPdf(borsWithExport || null, (attId || this.inst.model.sessionSettings.hostID))
          .map(prom => from(prom).pipe(
            catchError(err => {
              this.inst.logger.debug(`onBringBackPdf: ${err}`);
              return of(null);
            })
          ));
      } catch (e) {
        this.failedToRemoveRooms(borsWithExport);
        failedIds.push(...borsWithExport);
      }
      const exportedRoomIds = await forkJoin(requests).toPromise();
      exportedRoomIds.forEach(roomId => {
        if (roomId) {
          successfullyExported.add(roomId);
        }
      });
      borsWithExport.forEach(roomId => {
        if (!successfullyExported.has(roomId)) {
          this.failedToRemoveRooms([roomId]);
          failedIds.push(roomId);
        }
      });

      const successfullyExportedArr = Array.from(successfullyExported.values());
      try {
        const removed = await this._remove(successfullyExportedArr, true);
        removedIds = removedIds.concat(removed);
      } catch (e) {
        this.failedToRemoveRooms(successfullyExportedArr);
        failedIds.push(...successfullyExportedArr);
      }
    }
    return {removedIds, failedIds};
  }

  @ApmSpan()
  private failedToRemoveRooms(roomIds: string[]): void {
    roomIds.forEach(id => {
      this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_REMOVE_FAILED, { id });
      try {
        this.updateRoom(id, { removing: false });
      } catch (err) {
        this.inst.logger.error(err.message);
      }
    });
  }

  @ApmSpan()
  private async _remove(ids: string[], silent: boolean): Promise<string[]> {
    if (!ids?.length) {
      return [];
    }
    const response = await coreApi.delete(RestAPI.BORS, {
      data: {
        meetingID: this.inst.model.meetingID,
        roomIDs: ids
      }
    });

    if (response.status !== 200) {
      throw new Error(`${RestAPI.BORS} fails with (${response.status})`);
    }

    this.removeBor(ids, silent);
    if (!silent) {
      this.inst.server.sendTo(ClientConnectionAPI.BOR_REMOVE_ALL, { roomIds: ids });
    }

    return ids;
  }

  @ApmSpan()
  private removeBor(ids: string[], silent: boolean = false) {
    ids.forEach(id => {
      if (this.closeRoomSchedules[id]) {
        clearTimeout(this.closeRoomSchedules[id]);
        delete this.closeRoomSchedules[id];
      }
      const room = this.getRoomById(id);
      if (!room) {
        return;
      }
      this.inst.eventBus.emit(SessionEventTypes.ROOM_BEFORE_CLOSE, id);

      delete this.roomsByName[this.inst.model.roomsIndex[id].title];
      delete this.inst.model.roomsIndex[id];

      if (!silent) {
        this.inst.server.sendTo(ClientConnectionAPI.BOR_REMOVE, { id });
      }
      // @fixme - send one signal with list of ids instead one by one
      this.inst.server.sendMessage(MeetingMessagingCommands.ROOM_REMOVE, { id });

      this.inst.eventBus.emit(SessionEventTypes.ROOM_CLOSE, id);
    });
  }

  private canMoveToRoom(roomId: string, attendeeId: string): boolean {
    const attendee = this.inst.model.attendeesIndex[attendeeId];
    const room = this.inst.model.roomsIndex[roomId];

    // HOST/COHOST can see all rooms
    // ATTENDEES can see rooms that they are assigned for or rooms visible to all
    return attendee.role === Roles.HOST
      || attendee.role === Roles.COHOST
      || room.allowRoomMove === AllowedRoomMove.AllAttendees
      || (room.allowRoomMove === AllowedRoomMove.AssignedAttendees
        && room.meetingAttendees.indexOf(attendee.id) !== -1);

  }

  private _onMessage({ data, command, source }: any) {
    if (source.type === 'admin' && this.inst.name === source.name) {
      switch (command) {
        case MeetingMessagingCommands.ROOM_CREATE:
        // No break! We still want the ROOM_EDIT code to execute.
        // tslint:disable-next-line:no-switch-case-fall-through
        case MeetingMessagingCommands.ROOM_EDIT:
          this.addOrUpdateBORs(data.map(room =>
            this.createLocalBORUpdateDataV2(room)
          ));

          if (command === MeetingMessagingCommands.ROOM_CREATE) {
            const clonedRooms = data.filter(room => room.roomConfiguration === RoomConfiguration.CLONED);
            this.inst.eventBus.emit(ClonedRoomIdsCreatedEvent.type, clonedRooms.map(room => room.id));
            data.map(room => this.inst.eventBus.emit(RoomCreatedEvent.type, room.id));
          }
          this.inst.eventBus.emit(RoomSettingsChangeEvent.type, data);
          break;
        case MeetingMessagingCommands.ROOM_REMOVE:
          // @fixme if bor manager knows the attendee id use it here
          this.onRemoveBor(
            (data && data.id ? [ data.id ] : Object.keys(this.inst.model.roomsIndex).filter(id => id)),
            data.attendeeId || this.inst.model.sessionSettings.hostID
          );
          break;
        case MeetingMessagingCommands.ROOM_ADD_ATTENDEE:
          this.onBorAddAttendee(null, data);
          break;
        case MeetingMessagingCommands.ROOM_MOVE_ATTENDEE:
          if (data) {
            this.onBorMoveAttendees(null, data);
          } else {
            Object.values(this.inst.model.roomsIndex).forEach(room => {
              if (room.id) {
                this.onBorMoveAttendees(null, room.id);
              }
            });
          }
          break;
        case MeetingMessagingCommands.ROOM_BRINGBACK_ATTENDEES:
          this.onBorBringBackAttendees(null, data);
          break;
        case MeetingMessagingCommands.ATTENDEES_ASSIGN_TO_ROOM:
          this.onBorAttendeesAssign(data);
          break;
        case MeetingMessagingCommands.ATTENDEES_ASSIGN_REMOVE:
          this.onBorAttendeesAssignRemove(data);
          break;
        case MeetingMessagingCommands.ROOM_BRINGBACK_PDFS:
          const attendee = Object.values(this.inst.model.attendeesIndex).find(att => att.userAccountID === data.userAccountID);
          this.onBringBackPdf(data.borIds, attendee?.id || this.inst.model.sessionSettings.hostID);
          break;
        case MeetingMessagingCommands.BOR_MANAGER_STATE_CHANGE:
          this.inst.server.sendTo(ClientConnectionAPI.BOR_MANAGER_OPENED,
            (this.inst.model.sessionSettings.borManagerHolder = data.holder));
          break;
      }
    }
  }

  isRoomEmpty(roomId: string): boolean {
    return this.getAllAttendeeIdsForRoom(roomId).length === 0;
  }

  @ApmSpan()
  getRoomLeadCandidate(roomId: string, oldLeadId: string): Attendee | null {
    const roomAttendees = Object.values(this.inst.model.attendeesIndex)
      .filter(attendee => (
        attendee.id !== oldLeadId &&
        (attendee.role === Roles.PRESENTER || attendee.role === Roles.ATTENDEE) &&
        attendee.room === roomId && !attendee.left
      ));

    if (!roomAttendees.length) {
      return null;
    }

    const a = roomAttendees[0];
    return a;
  }

  @ApmSpan()
  protected populateState({ rooms }: RoomState) {
    for (const room of rooms) {
      this.inst.model.roomsIndex[room.id] = new Room(room);
    }
  }

  @ApmSpan()
  protected serializeState(): RoomState {
    const rooms = Object.values(
      this.inst.model.roomsIndex
    ).map(room => {
      const { whiteboard, whiteboardHistory, ...rest } = room.toJSON();

      return rest;
    });

    return { rooms };
  }

  @Socket(ServerConnectionAPI.WHITEBOARD_EVENT)
  @ApmTransaction(TransactionType.WS_REQUEST, {functionalDomain: FunctionalDomainType.WHITEBOARD})
  private handleWhiteboardEvents(@client client: Client, data) {
    if (!data) {
      return;
    }

    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      apm.captureError('Whiteboard event sender is missing');
      this.inst.logger.error('Whiteboard event sender is missing');
      return;
    }

    if (data.action === WhiteboardAction.LOCK_ERASER_STATE) {
      this.handleLockEraserState(attendee, data);
    } else if (data.action === WhiteboardAction.EXPORT_TO_PDF) {
      this.handleAnnotationsSaveToAssetLibrary(attendee, data);
    }
  }


  private handleLockEraserState(attendee: Attendee, data: WhiteboardEvent & { data: boolean }) {
    if (!this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      return;
    }
    const lockEraserProperty: string = data.type === (WhiteboardType.ANNOTATION) ? 'lockAnnotationsEraser' : 'lockWhiteboardEraser';
    this.inst.roomEngine.updateRoom(attendee.room, {[lockEraserProperty]: data.data});
  }

  private async handleAnnotationsSaveToAssetLibrary(attendee: Attendee,
                                                    data: WhiteboardEvent & { context: { documentId: string } }) {
    const room = this.inst.model.roomsIndex[attendee.room];
    const context = data.context;
    const wbSourceId = `${room.id}_${data.context.documentId}`;

    const worker = (await this.getPdfRemoteWorkerFactory()).create(
      `${this.inst.model.meetingID}${wbSourceId}`,
      PdfWorkMessage.fromAnyObject({
        workType: PdfWorkType.AnnotationExport,
        companyId: this.inst.model.sessionSettings.companyId,
        meetingId: this.inst.model.meetingID,
        annotationId: wbSourceId,
        mrid: attendee.room,
        roomTitle: room.title,
        documentId: context.documentId,
        attendeeId: attendee.id,
        boardWidth: this.inst.model.sessionSettings.boardWidth,
        boardHeight: this.inst.model.sessionSettings.boardHeight
      })
    );

    worker.observer.on('message', (message: WorkerMessage) => {
      this.inst.exportingEngine.sendWorkerStatusToAttendee(message, room.title);

      this.inst.exportingEngine.cleanStopWorkerOnDoneMessage(message, worker)
        .then(stopped => stopped && this.inst.logger.info('Remote PDF worker shut down. All listeners removed.'))
        .catch(error => {
          apm.captureError(error);
          this.inst.logger.error(`Failed shutting down remote PDF worker. ${error.message}`);
        });
    });

     return worker.run();
  }
}
