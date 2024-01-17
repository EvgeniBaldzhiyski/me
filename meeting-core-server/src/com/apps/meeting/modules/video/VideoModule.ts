import {
  Attendee,
  CamState,
  ClientConnectionAPI,
  ComponentNames,
  GridLayoutModes,
  MainWebCamData,
  RecordedMediaInterface,
  RecordedMediaObject,
  RecordedMediaState,
  SavePaneActiveCmp,
  ServerConnectionAPI,
  UpdateMessageData,
  AttendeeBase,
  RoomConfiguration,
  Room,
  AttCamRights,
  Roles,
  SessionSettings
} from '@container/models';
import { ApmSpan, ApmTransaction, FunctionalDomainType, TransactionType } from '@container/apm-utils';
import { ChangeActivePaneComponent, MoveAttendeesEvent, NoMainPresenterEvent, RoomSettingsChangeEvent, SessionEventTypes } from '../../events/SessionEvents';
import Meeting from '../../Meeting';
import BaseModule from '../BaseModule';
import Client from '../../../../utils/Client';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import { fromEvent } from 'rxjs';

export default class VideoModule extends BaseModule {

  private testRoomLogMessage = 'Unexpected Action in VideoModule for Test Room.';

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);

    this.inst.server.onSocket(ServerConnectionAPI.WEB_CAM_LAYOUT, (client, data) => this.changeWebCamLayout(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.WEB_CAM_MAIN_VIDEO,
      (client, data) => this.changeWebCamMainVideo(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.DISABLE_CAMS_FOR_ALL,
      (client, data) => this.disableCamsForAll(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.SET_RECORDED_VIDEO_STATE,
      (client, data) => this.setRecordedVideoState(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.SET_VIDEOLIST_ITEM,
      (client, data) => this.playVideolistItem(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.SET_RECORDED_VIDEO_SPEED,
      (client, data) => this.setRecordedVideoSpeed(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.VIDEO_TIME_SYNC,
      (client, data) => {
        this.updateVideoTime(data.roomId, data.attendeeId);
      });

    fromEvent(this.inst.eventBus, RoomSettingsChangeEvent.type).subscribe(data => this.onRoomSettingsChange(data));
    fromEvent(this.inst.eventBus, MoveAttendeesEvent.type).subscribe(({movedAids, rid}) => this.onMoveAttendees(movedAids, rid));
    fromEvent(this.inst.eventBus, NoMainPresenterEvent.type).subscribe(_ => this.stopRecordedVideo(''));
    fromEvent(this.inst.eventBus, SessionEventTypes.REFRESH_SETTINGS).subscribe(({oldSettings, settings}) => {
      this.onUpdateSessionSettings(oldSettings, settings);
    });
    fromEvent(this.inst.eventBus, ChangeActivePaneComponent.type).subscribe((data: ChangeActivePaneComponent) => {
      if (data.paneId === 1 && data.newActiveComponent !== ComponentNames.videosCmp) {
        this.stopRecordedVideo(data.roomId);
      }
    });
  }

  @Socket(ServerConnectionAPI.AVAILABLE_CAM_DEVICE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private camAvailable(@client client: Client, hasCam: boolean) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (attendee.hasCam === hasCam) {
      return;
    }

    const camState = this.getNewCamState(attendee, hasCam);
    const updatePack: Pick<AttendeeBase, ('hasCam' | 'camState')> = {};

    if (camState !== attendee.camState) {
      updatePack.camState = camState;
    }

    if (hasCam !== attendee.hasCam) {
      updatePack.hasCam = hasCam;
    }

    if (updatePack.camState !== undefined || updatePack.hasCam !== undefined) {
      this.inst.updateEngine.updateAttendee(null, attendee.id, updatePack);
    }
  }

  @Socket(ServerConnectionAPI.CHANGE_CAM_VISIBILITY)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private changeCamVisibility(@client client: Client, {aid, right}: {aid: Attendee['id'], right: AttCamRights}) {
    const sender = this.inst.model.attendeesIndex[client.data.aid];
    const attendee = this.inst.model.attendeesIndex[aid];
    const room = this.inst.model.roomsIndex[attendee?.room];

    if (!sender || !attendee || !room) {
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(sender, sender.room)) {
      return;
    }

    if (room.roomConfiguration === RoomConfiguration.TESTROOM) {
      return;
    }

    this.inst.updateEngine.updateAttendee(null, aid, {
      camRights: right,
      flagState: {...attendee.flagState, camRights: right}
    });
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private onRoomSettingsChange(data) {
    data.forEach(settings => {
      if (settings.enableVideo === false) {
        this.stopRecordedVideo(settings.id);
      }

      if (settings.enableWebcams === false) {
        const updateMessageData = Object.values(this.inst.model.attendeesIndex)
        .filter(attendee => attendee.room === settings.id)
        .map(attendee => new UpdateMessageData(attendee.id, { camState: CamState.off }));

        if (updateMessageData && updateMessageData.length) {
          this.inst.updateEngine.updateAttendees(null, updateMessageData);
        }
      }
    });
  }

  private getRolePriority(role: Roles) {
    switch (role) {
      case Roles.HOST:
        return 3;
      case Roles.COHOST:
        return 2;
      case Roles.LEAD:
        return 1;
    }
    return 0;
  }

  private onMoveAttendees(aids: Set<Attendee['id']>, rid: Room['id']) {
    const updatePacks: UpdateMessageData[] = [];

    const affectedIds = [];
    for (const aid of aids.values()) {
      const attendee = this.inst.model.attendeesIndex[aid];

      if (!attendee) {
        continue;
      }

      if (attendee.camState === CamState.on) {
        affectedIds.push({aid, role: attendee.role});
      }
    }

    affectedIds.sort((a, b) => this.getRolePriority(b.role) - this.getRolePriority(a.role));

    const tooMuchAids = this.tooManyCamerasInRoom(affectedIds.map(item => item.aid), rid);

    for (const aid of tooMuchAids) {
      updatePacks.push(new UpdateMessageData(aid, {camState: CamState.off}));
    }

    this.inst.sendToAttendees(tooMuchAids, ClientConnectionAPI.MAX_CAMERAS_ROOM);
    this.inst.updateEngine.updateAttendees(null, updatePacks);
  }

  @ApmSpan()
  async approveAttendeeChange(_, id, data, done) {
    const attendee = this.inst.model.attendeesIndex[id];

    if (!attendee) {
      return done(data);
    }

    if (data.isAway !== undefined) {
      if (attendee.camState === CamState.on) {
        data.camState = CamState.off;
      }
    }

    if (data.camState !== undefined) {
      const enableWebcam = this.inst.layoutEngine.getLayoutsSetting(attendee.room, 'enableWebcams');

      if (enableWebcam === false && data.camState === CamState.on) {
        delete data.camState;
      }

      if (data.camState === CamState.denied) {
        data.camDenied = true;
      } else if (data.camState === CamState.off && attendee.camState === CamState.denied) {
        data.camDenied = false;
      }
    }

    if (data.hasCam === false) {
      data.camState = CamState.missing;
    }

    if (data.hasBaton && attendee.camState === CamState.denied) {
      data.camState = CamState.off;
    }

    const room = this.inst.roomEngine.getRoomById(attendee.room);

    if (data.left || (data.camState !== undefined && data.camState !== CamState.on)) {
      // we check if this is the main cam in the old room
      if (room && room.mainWebCam.attId === id) {
        const mainWebCamData = new MainWebCamData(this.findFirstCam(room.id, attendee.id), null, false, true);

        this.inst.roomEngine.update({ id: room.id, mainWebCam: mainWebCamData });
        this.inst.roomEngine.sendToRoom(room.id, ClientConnectionAPI.WEB_CAM_MAIN_VIDEO, mainWebCamData);
      }
    } else if (data.room !== undefined) {
      const camState = data.camState !== undefined ? data.camState : attendee.camState;
      const newRoom = this.inst.roomEngine.getRoomById(data.room);

      if (newRoom && camState === CamState.on && (!newRoom.mainWebCam || !newRoom.mainWebCam.attId)) {
        const mainWebCamData = new MainWebCamData(attendee.id, null, false);

        this.inst.roomEngine.update({ id: newRoom.id, mainWebCam: mainWebCamData });
        this.inst.roomEngine.sendToRoom(newRoom.id, ClientConnectionAPI.WEB_CAM_MAIN_VIDEO, mainWebCamData);
      }

      if (room && room.mainWebCam.attId === id) {
        const mainWebCamData = new MainWebCamData(this.findFirstCam(room.id, attendee.id), null, false);

        this.inst.roomEngine.update({ id: room.id, mainWebCam: mainWebCamData });
        this.inst.roomEngine.sendToRoom(room.id, ClientConnectionAPI.WEB_CAM_MAIN_VIDEO, mainWebCamData);
      }
    } else if (data.camState !== undefined && data.camState === CamState.on && (!room.mainWebCam || !room.mainWebCam.attId)) {
      // TODO: see why if we use senderId: null, the attId is also null on the client???
      const mainWebCamData = new MainWebCamData(id, null, false);

      this.inst.roomEngine.update({ id: room.id, mainWebCam: mainWebCamData });
      this.inst.roomEngine.sendToRoom(room.id, ClientConnectionAPI.WEB_CAM_MAIN_VIDEO, mainWebCamData);
    }

    if (data.room !== undefined || (data.hasBaton !== undefined && data.hasBaton === false)) {
      if (attendee.camState !== CamState.missing) {
        const roomCamsEnabled = data.room !== undefined ?
                                this.inst.roomEngine.getRoomById(data.room).enableAllCams :
                                room.enableAllCams;

        if (roomCamsEnabled && attendee.camState === CamState.denied) {
          data.camState = CamState.off;
          data.camDenied = false;
        } else if (
          (!roomCamsEnabled || attendee.camState === CamState.denied) &&
          (attendee.hasBaton === false || data.hasBaton === false)
        ) {
          data.camState = CamState.denied;
          data.camDenied = true;
        }

        if ((!roomCamsEnabled && attendee.camState === CamState.on) || (!roomCamsEnabled && attendee.camState === CamState.off)) {
          data.camState = attendee.camState === CamState.on ? CamState.on : CamState.off;
          data.camDenied = false;
        }
      }

      if (data.camState === attendee.camState) {
        delete data.camState;
        delete data.camDenied;
      }
    }

    if (data.room !== undefined) {
      const newRoom = this.inst.roomEngine.getRoomById(data.room);

      if (!this.inst.layoutEngine.hasLayoutSettings(newRoom.id)) {
        await this.inst.layoutEngine.loadLayoutSettings(newRoom.id).toPromise();
      }

      const enableWebcam = this.inst.layoutEngine.getLayoutsSetting(newRoom.id, 'enableWebcams');

      if (!enableWebcam) {
        data.camState = CamState.off;

        return done(data);
      }
    }

    if (data.left !== undefined || data.hasBaton !== undefined || data.room !== undefined || data.attendeeAdded !== undefined) {
      let targetRoom = room;
      if (data.room !== undefined) {
        targetRoom = this.inst.roomEngine.getRoomById(data.room);
      }

      const camRights = this.assignCamVisibility(
        (data.hasBaton !== undefined ? data.hasBaton : attendee.hasBaton),
        targetRoom,
        attendee.flagState?.camRights
      );

      if (attendee.camRights !== camRights) {
        data.camRights = camRights;
      }
    }

    if (data.kickedOut !== undefined) {
      if (attendee.camState !== CamState.off) {
        data.camState = CamState.off;
      }
    }

    if (data.camState === CamState.on || (data.left === false && attendee.camState === CamState.on)) {
      if (this.tooManyCamerasInRoom([attendee.id], room.id).length) {
        data.camState = CamState.off;

        this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.MAX_CAMERAS_ROOM);
      }
    }

    done(data);
  }

  private assignCamVisibility(hasBaton: boolean, room?: Room, rights?: Attendee['camRights']): AttCamRights {
    if (hasBaton) {
      return AttCamRights.EVERYONE;
    }

    if (room && room.isTestRoom) {
      return AttCamRights.PRESENTERS_ONLY;
    } else {
      if (rights) {
        return rights;
      }

      return (this.inst.model.sessionSettings.webCamsAvailability === AttCamRights.PRESENTERS_ONLY ?
        AttCamRights.PRESENTERS_ONLY : AttCamRights.EVERYONE
      );
    }
  }

  @ApmSpan()
  private findFirstCam(roomId: string, oldMainCam: string): string {
    const attendeeId = this.inst.roomEngine.getAllAttendeeIdsForRoom(roomId).find((attId) =>
      attId !== oldMainCam && !this.inst.model.attendeesIndex[attId].left && this.inst.model.attendeesIndex[attId].camState === CamState.on
    );
    return attendeeId ? attendeeId : null;
  }

  @ApmSpan()
  private getNewCamState(attendee: Attendee, hasCam: boolean): CamState {
    const room = this.inst.model.roomsIndex[attendee.room];

    if (!hasCam) {
      return CamState.missing;
    }

    if (!attendee.hasBaton) {
      if (attendee.camDenied === true) {
        return CamState.denied;
      }

      if (!room?.enableAllCams/* && this.inst.model.sessionSettings.webCamsAvailability === AttCamRights.NONE*/) {
        return CamState.denied;
      }
    }

    return CamState.off;
  }

  private tooManyCamerasInRoom(ids: Array<Attendee['id']>, rid: Room['id']): Array<Attendee['id']> {
    const room = this.inst.roomEngine.getRoomById(rid);
    if (!room) {
      throw new Error('The target room does not exist.');
    }

    const maxCameras = (room.isTestRoom ?
      this.inst.model.sessionSettings.maxAllowedWebCamsInTestRoom : this.inst.model.sessionSettings.maxAllowedWebCams
    );

    let sharedCams = 0;
    for (const attendee of Object.values(this.inst.model.attendeesIndex)) {
      if (attendee.left || ids.includes(attendee.id) || attendee.room !== rid) {
        continue;
      }

      if (attendee.camState === CamState.on) {
        sharedCams++;
      }
    }

    const tooMuch = maxCameras - (sharedCams + ids.length);

    if (tooMuch < 0) {
      return ids.splice(tooMuch);
    }

    return [];
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  public changeWebCamLayout(client, data: GridLayoutModes) {
    const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const room = this.inst.model.roomsIndex[a && a.room];

    if (room && this.inst.roomEngine.isRoomPresenter(a, a.room)) {
      this.inst.roomEngine.updateRoom(room.id, { webCamLayout: data });
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  public changeWebCamMainVideo(client, data: MainWebCamData) {
    const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (a) {
      const roomId = a.room;
      const room = this.inst.model.roomsIndex[roomId];

      if (this.inst.roomEngine.isRoomPresenter(a, a.room)) {
        this.inst.model.roomsIndex[a.room].mainWebCam = data;
        this.inst.roomEngine.update({ id: room.id, mainWebCam: data });
        data.senderId = client.data.aid;
        // this.inst.server.sendTo(ClientConnectionAPI.WEB_CAM_MAIN_VIDEO, data);
        this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.WEB_CAM_MAIN_VIDEO, data);
      }
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private disableCamsForAll(client, isCamsEnabled: boolean) {
    const att: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (this.inst.roomEngine.getRoomById(att.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    if (this.inst.roomEngine.isRoomPresenter(att, att.room)) {
      this.inst.roomEngine.update({ id: att.room, enableAllCams: isCamsEnabled });
      const updatedAttArray = this.inst.roomEngine.getAllAttendeeIdsForRoom(att.room)
        .filter(attId => {
          const attendee: Attendee = this.inst.model.attendeesIndex[attId];
          return attendee.role !== Roles.GHOST && !this.inst.roomEngine.isRoomPresenter(attendee, attendee.room);
        })
        .map(attId => {
          const attendee: Attendee = this.inst.model.attendeesIndex[attId];
          let camState: CamState;
          if (this.inst.roomEngine.isHost(attendee) || attendee.hasBaton) {
            // case IV - #1353
            camState = isCamsEnabled === false ? CamState.off : attendee.camState;
          } else if (isCamsEnabled) {
            // case III - #1353
            camState = attendee.camState === CamState.on ? CamState.on : CamState.off;
          } else {
            camState = CamState.denied;
          }

          return new UpdateMessageData(attId, { 'camState': camState, 'camDenied': !isCamsEnabled });
        });
      if (updatedAttArray) {
        this.inst.updateEngine.updateAttendees(client, updatedAttArray);
      }
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'videos' })
  public setRecordedVideoState(client, data: RecordedMediaInterface | RecordedMediaState) {
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const roomId = sender.room;
    const room = this.inst.model.roomsIndex[roomId];

    if (room && room.isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(sender, roomId)) {
      return;
    }
    const sharedVideoData = { ...data as RecordedMediaObject };

    const timeStamp = new Date().getTime();

    if ((data as RecordedMediaState) === RecordedMediaState.STOP) {
      this.stopRecordedVideo(roomId);
    } else {
      sharedVideoData.senderId = client.data.aid;
      sharedVideoData.timeStamp = timeStamp;

      room.recordedVideos[sharedVideoData.meetingAssetID] = new RecordedMediaObject(
        sharedVideoData.accumulatedTime,
        sharedVideoData.name,
        sharedVideoData.timeStamp,
        sharedVideoData.state,
        sharedVideoData.rate,
        sharedVideoData.fileUrl,
        sharedVideoData.meetingAssetID,
        sharedVideoData.playlistID,
        sharedVideoData.displayOrder,
        sharedVideoData.fileDuration
      );

      if ( // INITIAL PLAY
        // if we play video and don't have set active component OR we have active component
        // BUT is different than wanted -> in this case Video Component
        // => set to wanted component
        (data as RecordedMediaInterface).state === RecordedMediaState.PLAY &&
        (Object.keys(this.inst.model.roomsIndex[sender.room].paneActiveCmp).length === 0) ||
        (Object.keys(this.inst.model.roomsIndex[sender.room].paneActiveCmp).length !== 0 &&
          (this.inst.model.roomsIndex[sender.room].paneActiveCmp[(data as RecordedMediaInterface).paneId]
            !== (data as RecordedMediaInterface).activeCmpName))
      ) {
        this.inst.layoutEngine.savePaneActiveCmp(client,
          new SavePaneActiveCmp(sender.id,
            (data as RecordedMediaInterface).paneId,
            ComponentNames.videosCmp));
      }

      // Below is the case of PLAY OR PAUSE STATE
      this.inst.roomEngine.update({ recordedVideos: room.recordedVideos, id: room.id });
      this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.SET_RECORDED_VIDEO_STATE, sharedVideoData, false);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'videos' })
  private playVideolistItem(client, data: {videolistItem: RecordedMediaInterface, notifyRoom: boolean}) {
    const {videolistItem, notifyRoom} = data;
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const room = this.inst.model.roomsIndex[sender.room];

    // remove current recorded video
    room.recordedVideos = {};

    videolistItem.senderId = sender.id;
    videolistItem.timeStamp = new Date().getTime();

    room.recordedVideos[videolistItem.meetingAssetID] = new RecordedMediaObject(
      videolistItem.accumulatedTime,
      videolistItem.name,
      videolistItem.timeStamp,
      videolistItem.state,
      videolistItem.rate,
      videolistItem.fileUrl,
      videolistItem.meetingAssetID,
      videolistItem.playlistID,
      videolistItem.displayOrder,
      videolistItem.fileDuration
    );

    this.inst.roomEngine.update({ recordedVideos: room.recordedVideos, id: room.id });
    if (notifyRoom) {
      this.inst.roomEngine.sendToRoom(room.id, ClientConnectionAPI.SET_RECORDED_VIDEO_STATE, videolistItem, false);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'videos' })
  private onUpdateSessionSettings(oldSettings: SessionSettings, settings: SessionSettings) {
    if (oldSettings.webCamsAvailability !== settings.webCamsAvailability) {
      const updateList: UpdateMessageData[] = [];

      for (const attendee of Object.values(this.inst.model.attendeesIndex)) {
        const camState = this.getNewCamState(attendee, attendee.hasCam);

        if (camState !== attendee.camState) {
          updateList.push(new UpdateMessageData(attendee.id, {camState}));
        }
      }

      if (updateList.length) {
        this.inst.updateEngine.updateAttendees(null, updateList);
      }
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'videos' })
  private stopRecordedVideo(roomId: string) {
    const room = this.inst.model.roomsIndex[roomId];
    room.recordedVideos = {};

    const sharedVideoData: any = {};
    sharedVideoData.state = RecordedMediaState.STOP;

    this.inst.roomEngine.update({ recordedVideos: room.recordedVideos, id: room.id });
    this.inst.roomEngine.sendToRoom(room.id, ClientConnectionAPI.SET_RECORDED_VIDEO_STATE, sharedVideoData);
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'videos' })
  private setRecordedVideoSpeed(client, data: any) {
    const senderId = client.data.aid;
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const roomId = sender.room;
    const room = this.inst.model.roomsIndex[roomId];

    if (room && room.isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(sender, roomId)) {
      return;
    }

    const speedObject = {};
    speedObject['senderId'] = senderId;
    speedObject['rate'] = data;

    // update recordedVideos (rate) property of Room
    const recordedVideoId = Object.keys(room.recordedVideos)[0];
    room.recordedVideos[recordedVideoId].rate = data;

    // TODO: uncomment this if we decide to implement this feature in group videos / audios
    // this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.SET_RECORDED_VIDEO_SPEED, speedObject, false);
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'videos' })
  private updateVideoTime(roomId, attendeeId) {
    const room = this.inst.roomEngine.getRoomById(roomId);
    let playedVideo = null;
    if (room && (Object.keys(room.recordedVideos).length)) {
      playedVideo = Object.values(room.recordedVideos)[0];
    }
    if (playedVideo) {
      const sharedVideoData = { ...playedVideo as RecordedMediaObject };
      const currentTimestamp = (new Date()).getTime();
      let accTime = sharedVideoData.accumulatedTime;

      if (sharedVideoData.state === 1) {
        accTime = sharedVideoData.accumulatedTime + (currentTimestamp - sharedVideoData.timeStamp);
      }

      this.inst.sendToAttendee(attendeeId, ClientConnectionAPI.MEDIA_TIME_SYNC, { roomId: room.id, playTime: accTime });
    }
  }
}
