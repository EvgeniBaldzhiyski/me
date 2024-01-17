import {
  Attendee,
  CamState,
  ClientConnectionAPI,
  ComponentNames,
  MicState,
  RecordedMediaInterface,
  RecordedMediaObject,
  RecordedMediaState,
  Roles,
  Room,
  SavePaneActiveCmp,
  ServerConnectionAPI,
  UpdateMessageData
} from '@container/models';
import { ApmSpan, ApmTransaction, FunctionalDomainType, TransactionType } from '@container/apm-utils';
import {
  ChangeActivePaneComponent,
  NoMainPresenterEvent,
  RoomEditedEvent,
  RoomSettingsChangeEvent
} from '../../events/SessionEvents';
import Meeting from '../../Meeting';
import BaseModule from './../BaseModule';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import Client from '../../../../utils/Client';

export default class AudioModule extends BaseModule {

  private testRoomLogMessage = 'Unexpected Action in AudioModule for Test Room.';

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.eventBus.on(ChangeActivePaneComponent.type, (data: ChangeActivePaneComponent) => {
      if (data.paneId === 1 && data.newActiveComponent !== ComponentNames.audiosCmp) {
        this.stopRecordedAudio(data.roomId);
      }
    });

    this.inst.eventBus.on(NoMainPresenterEvent.type, () => {
      this.stopRecordedAudio('');
    });

    this.inst.updateEngine.registerApprover(this);

    this.inst.server.onSocket(
      ServerConnectionAPI.AVAILABLE_MIC_DEVICE,
      (client, data) => this.micAvailable(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.PTT_ON_OFF_FOR_ALL,
      (client, data) => this.setPTTForAll(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.TOGGLE_MIC_FOR_ATTENDEES,
      (client, data) => this.toggleMicForAttendees(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.HOST_TOGGLE_ALL_MICS,
      (client, data) => this.hostToggleAllMics(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.TOGGLE_PRIVATE_CONVERSATION,
      (client, data) => this.togglePrivateConversation(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.SET_RECORDED_AUDIO_STATE,
      (client, data) => this.setRecordedAudioState(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.SET_RECORDED_AUDIO_SPEED,
      (client, data) => this.setRecordedAudioSpeed(client, data));

    this.inst.server.onSocket(
      ServerConnectionAPI.AUDIO_TIME_SYNC,
      (client, data) => {
        this.updateAudioTime(data.roomId, data.attendeeId);
      });

    this.inst.eventBus.on(RoomEditedEvent.type, (data: RoomEditedEvent) => this.onRoomUpdate(data.id, data.config));

    this.inst.eventBus.on(RoomSettingsChangeEvent.type, data => {
      data.forEach(settings => {
        if (settings.enableAudio === false) {
          this.stopRecordedAudio(settings.id);
        }
      });
    });
  }

  // @TODO - NEED FULL REVIEW BECAUSE HAS A LOT LOGICAL MISTAKES AND LEAKS
  @ApmSpan()
  approveAttendeeChange(client, id, data, done) {
    const target: Attendee = this.inst.model.attendeesIndex[id];

    if (!target) {
      return done(data);
    }

    this.manageAwayMicState(id, data);

    if (this.manageMicState(client, id, data, !client) === null) {
      return done(null);
    }

    this.manageLeftCase(id, data);
    this.managePrivateConversation(id, data);

    const tmp = Object.assign({}, target, data);

    const micState = this.getNewMicState(tmp, tmp.room, tmp.hasBaton, tmp.hasMic);
    // check if realy needs to be send
    if (micState !== target.micState) {
      data.micState = micState;
    }

    if (target.staticRole === Roles.MIXER && data.attendeeAdded !== undefined) {
      data.hasMic = true;
      data.micMuted = false;
      data.micState = MicState.pttOff;
      data.pttState = false;
    }

    done(data);
  }

  @ApmSpan()
  private manageMicState(client, id, data, isGenClient) {
    const att: Attendee = this.inst.model.attendeesIndex[id];
    if (!att) {
      return false;
    }

    if (data.attendeeAdded || data.kickedOut) {
      const micState = this.getNewMicState(att, att.room, att.hasBaton, att.hasMic);

      if (micState !== att.micState) {
        data.micState = micState;
      }
      return false;
    }

    if (data.micState !== undefined) {
      let requester: Attendee;
      if (client) {
        requester = this.inst.model.attendeesIndex[client.data.aid];
      } else {
        requester = new Attendee({
          hasBaton: true,
          room: att.room
        });
      }

      if (requester.id !== id && !requester.hasBaton) {
        return null;
      }

      if (data.micState !== MicState.denied) {
        if (!requester.hasBaton && att.micDenied) {
          return null;
        }

        if (requester.hasBaton && requester.id != att.id && !isGenClient &&
          (data.micState === MicState.normal || data.micState === MicState.pttOff)
        ) {
          data.micDenied = false;
        }
      }

      if (data.micState === MicState.talking) {
        if (!att.phoneAudio) {
          const hasTalker: Attendee = Object.values(this.inst.model.attendeesIndex).find(a =>
            (a.room === requester.room && !a.phoneAudio && (a.micState === MicState.talking || a.micState === MicState.pttMuted))
          );

          if (hasTalker && this.inst.roomEngine.isHost(hasTalker) && hasTalker.micState !== MicState.pttMuted) {
            return null;
          }
          if (!data.phoneAudio) {
            data.micMuted = false;
          }

          // If has tolker and requester is Co-Host or host the toker is forced to release the button.
          if (hasTalker && id !== hasTalker.id &&
            ((requester.hasBaton && !this.inst.roomEngine.isHost(hasTalker)) || this.inst.roomEngine.isHost(requester))) {
            this.inst.updateEngine.updateAttendee(client, hasTalker.id, { micState: MicState.normal });
          }
        }
      } else if (data.micState === MicState.muted) {
        data.micMuted = true;
      } else if (data.micState === MicState.pttOff) {
        if (client) {
          const clientAtt = this.inst.model.attendeesIndex[client.data.aid];
          const room = this.inst.roomEngine.getRoomById(att.room);
          // only I can unmute
          // in test room Host/Co-Host can unmute attendee mic to listen in
          // host/co-host is other room also can unmute attendee in test room
          if (clientAtt && (clientAtt.id === id ||
              (this.inst.roomEngine.isRoomPresenter(clientAtt, clientAtt.room) &&
               room && room.isTestRoom))) {

            data.micMuted = false;
          }
        } else if (att.micMuted) {
          data.micState = MicState.muted;
        }
      } else if (data.micState === MicState.denied) {
        data.micDenied = true;
        // @TODO - problem that solve this change.
        // - If Presenter disable my mic but I use it before this I do not have any option to mute it
        // - If presenter enable my mic but I miss this moment there has a chanse other to hear something that I do not want to be heard
        data.micMuted = true;
      }
    } else {
      if (data.room !== undefined) {
        const attData = Object.assign({}, att, data, {
          pttState: null,
          micDenied: null
        });
        const newMicState = this.getNewMicState(attData, data.room, attData.hasBaton, attData.hasMic);
        const newMicMuted = !(!att.micMuted && (newMicState === MicState.talking || newMicState === MicState.pttOff));

        if (att.pttState !== null) {
          data.pttState = null;
        }
        if (att.micDenied !== null) {
          data.micDenied = null;
        }
        if (att.micMuted !== newMicMuted) {
          data.micMuted = newMicMuted;
        }
      }
    }
  }

  @ApmSpan()
  private manageAwayMicState(id, data) {
    if (data.isAway !== undefined) {
      const attendee: Attendee = this.inst.model.attendeesIndex[id];

      if (data.isAway) {
        if (!attendee.micDenied) {
          if (attendee.micState === MicState.talking || attendee.micState === MicState.pttMuted) {
            data.micState = MicState.normal;
          }

          if (attendee.micState === MicState.pttOff) {
            data.micState = MicState.muted;
            data.micMuted = true;
          }
        } else {
          if (attendee.phoneAudio && attendee.micState !== MicState.talking) {
            data.micState = MicState.talking;
          }
        }
      }
    }
  }

  @ApmSpan()
  private manageLeftCase(id, data) {
    const a: Attendee = this.inst.model.attendeesIndex[id];
    if (data.left === true) {
      if (a.phoneAudio && !data.phoneAudio) {
        return;
      }
      if (a.micState === MicState.talking || a.micState === MicState.pttMuted) {
        data.micState = MicState.normal;
      }
    }
  }

  @ApmSpan()
  private managePrivateConversation(id, data) {
    const a: Attendee = this.inst.model.attendeesIndex[id];

    if (!a.speakerAttendeeId) {
      return;
    }

    if (data.left === true ||
        data.kickedOut ||
        data.room !== undefined ||
        data.role !== undefined && (data.role !== Roles.COHOST || data.role !== Roles.HOST)) {
      data.speakerAttendeeId = '';
      this.inst.updateEngine.updateAttendee(null, a.speakerAttendeeId, {speakerAttendeeId: '', micState: MicState.pttOff});
    }
  }

  @ApmSpan()
  private getNewMicState(attendee: Attendee, roomId: string, hasBaton: boolean, hasMic: boolean): MicState {
    const room = this.inst.model.roomsIndex[roomId];

    let roomOpenMic = false;
    if ((attendee.pttState === false) || (attendee.pttState !== true && room?.pushToTalk === false)) {
      roomOpenMic = true;
    }

    let micState: MicState = attendee.micState;

    if (room?.isTestRoom && !hasBaton &&
      attendee.micState !== MicState.missing && attendee.micState !== MicState.pttOff &&
        !attendee.speakerAttendeeId) {
      return micState = MicState.listenIn;
    }

    if (hasMic === false && !attendee.phoneAudio) {
      return MicState.missing;
    }
    if (attendee.phoneAudio && (attendee.staticRole === Roles.HOST || attendee.staticRole === Roles.COHOST)) {
      return MicState.normal;
    }

    const a = this.inst.model.attendeesIndex[attendee.id];

    // phone out/in
    if (a.phoneAudio !== attendee.phoneAudio) {
      attendee.micState = MicState.normal;
    }

    if (!hasBaton && !room?.isTestRoom && (attendee.micDenied || (
      attendee.micDenied === null && attendee.staticRole !== Roles.MIXER && !room?.enabledAllMic
    ))) {
      micState = MicState.denied;
    } else {
      // if phone is not available
      if (attendee.phoneAudio) {
        if (attendee.micState === MicState.talking) {
          micState = MicState.talking;
        } else {
          micState = MicState.normal;
        }
      } else {
        if (roomOpenMic) {
          if (attendee.micMuted) {
            micState = MicState.muted;
          }
        } else {
          // change room but there has not phone
          if (attendee.room !== a.room) {
            // @TODO - better check if there has talker
            if (!roomOpenMic) {
              attendee.micState = MicState.normal;
            }
          }

          if (attendee.micState === MicState.talking) {
            micState = MicState.talking;
          } else if (attendee.micState === MicState.pttMuted) {
            micState = hasBaton ? MicState.pttMuted : MicState.normal;
          } else {
            micState = MicState.normal;
          }
        }
      }
    }

    if (hasMic && micState === MicState.missing) {
      micState = MicState.muted;
    }

    return micState;
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private micAvailable(client: Client, value: boolean) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (attendee.hasMic === value) {
      return;
    }

    let micState = attendee.micState;

    if (value) {
      micState = this.getNewMicState(attendee, attendee.room, attendee.hasBaton, value);
    } else {
      micState = MicState.missing;
    }

    this.inst.updateEngine.updateAttendee(client, attendee.id, { micState: micState, hasMic: value });
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRoomUpdate(id: string, config: any) {
    const room = this.inst.roomEngine.getRoomById(id);
    if (!room) {
      return;
    }

    if (config.pushToTalk !== undefined) {
      this._setPTTForAll(room);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private setPTTForAll(client, isPTTForAll: boolean) {
    const att: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (this.inst.roomEngine.getRoomById(att.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    if (this.inst.roomEngine.isRoomPresenter(att, att.room)) {
      this.inst.roomEngine.update({ id: att.room, pushToTalk: isPTTForAll ? true : false });
    }
  }

  @ApmSpan()
  private _setPTTForAll(room: Room) {
    const micState = room.pushToTalk ? MicState.normal : MicState.muted;
    const updatedAttArray = [];
    this.inst.roomEngine.getAllAttendeeIdsForRoom(room.id)
      .forEach((attId) => {
        // do not update state if is denied
        const attendee: Attendee = this.inst.model.attendeesIndex[attId];
        let updateData;

        if (
          (attendee.phoneAudio) ||
          (attendee.pttState === true && attendee.micState === MicState.talking) ||
          (room.pushToTalk === false && attendee.pttState === false && attendee.micMuted === false)
        ) {
          // so we do not change his micState - #1509
        } else if (attendee.micState !== MicState.denied) {
          // @TODO - here should first check attendee for change before add values for update
          updateData = {
            'micState': (micState === MicState.muted && attendee.micState === MicState.talking) ? MicState.pttOff : micState,
            'micMuted': (micState === MicState.muted && attendee.micState === MicState.talking) ? false : true
          };
        }

        if (attendee.pttState !== null) {
          if (!updateData) {
            updateData = {};
          }
          updateData.pttState = null;
        }
        if (updateData) {
          updatedAttArray.push(new UpdateMessageData(attId, updateData));
        }
      });

    if (updatedAttArray) {
      this.inst.updateEngine.updateAttendees(null, updatedAttArray);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private hostToggleAllMics(client, toggleAllMics: boolean) {
    const att: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!this.inst.roomEngine.isRoomPresenter(att, att.room)) {
      return;
    }
    this.inst.roomEngine.update({ id: att.room, toggleAllMics: toggleAllMics });
    const micState = toggleAllMics ? MicState.pttOff : MicState.listenIn;

    const updatedAttArray = [];
    this.inst.roomEngine.getAllAttendeeIdsForRoom(att.room)
      .filter(attId => {
        const attendee: Attendee = this.inst.model.attendeesIndex[attId];
        return attendee.role !== Roles.GHOST &&
              !this.inst.roomEngine.isRoomPresenter(attendee, attendee.room) &&
              !attendee.speakerAttendeeId;
      })
      .forEach((attId) => {
        const attendee: Attendee = this.inst.model.attendeesIndex[attId];
        if (attendee.micState !== MicState.missing && micState !== attendee.micState) {
          updatedAttArray.push(
            new UpdateMessageData(attId, { micState })
          );
        }
      });

    if (updatedAttArray.length) {
      this.inst.updateEngine.updateAttendees(client, updatedAttArray);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private togglePrivateConversation(client, data: { speakerAttendeeId: string, privateConversation: boolean }) {
    const initiator: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!this.inst.roomEngine.isRoomPresenter(initiator, initiator.room)) {
      return;
    }
    const attendee: Attendee = this.inst.model.attendeesIndex[data.speakerAttendeeId];
    if (!attendee) {
      return;
    }

    // only initiator can stop conversation
    if (attendee.speakerAttendeeId && attendee.speakerAttendeeId !== initiator.id) {
      return;
    }

    const updatedAttArray = [];
    if (data.privateConversation) {
      // start private audio conversation
      updatedAttArray.push(new UpdateMessageData(data.speakerAttendeeId, {
        'speakerAttendeeId' : initiator.id,
        'micState' : MicState.pttOff,
        'micMuted' : false
      }));
      updatedAttArray.push(new UpdateMessageData(initiator.id, {
        'speakerAttendeeId' : data.speakerAttendeeId,
        'micState' : MicState.pttOff,
        'micMuted' : false
      }));
    } else {
      // stop private audio conversation
      updatedAttArray.push(new UpdateMessageData(data.speakerAttendeeId, {
        'speakerAttendeeId' : '',
        'micState' : MicState.listenIn,
        'micMuted' : true
      }));
      updatedAttArray.push(new UpdateMessageData(initiator.id, {
        'speakerAttendeeId' : '',
        'micState' : MicState.muted,
        'micMuted' : true
      }));
    }

    if (updatedAttArray.length) {
      this.inst.updateEngine.updateAttendees(client, updatedAttArray);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private toggleMicForAttendees(client, isMicEnabled: boolean) {
    const att: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (this.inst.roomEngine.getRoomById(att.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    this.inst.roomEngine.update({ id: att.room, enabledAllMic: isMicEnabled });
    if (this.inst.roomEngine.isRoomPresenter(att, att.room)) {
      const updatedAttArray = this.inst.roomEngine.getAllAttendeeIdsForRoom(att.room)
        .filter(attId => {
          // disable/enable mic only for attendee, filter if is isHost or co-host
          const attendee: Attendee = this.inst.model.attendeesIndex[attId];
          return attendee.role !== Roles.GHOST && !this.inst.roomEngine.isRoomPresenter(attendee, attendee.room);
        })
        .map(attId => {
          const attendee: Attendee = this.inst.model.attendeesIndex[attId];
          let micState: MicState = MicState.normal;

          // if ptt is off for all and enabled all mic, set all state to pttOff
          if (isMicEnabled) {
            const openMicState = attendee.micMuted ? MicState.muted : MicState.pttOff;
            if (attendee.micState === MicState.talking) {
              micState = MicState.talking;
            } else if (attendee.pttState === null) {
              micState = (!this.inst.model.roomsIndex[attendee.room].pushToTalk) ? openMicState : MicState.normal;
            } else {
              micState = (attendee.pttState) ? MicState.normal : openMicState;
            }
          } else {
            micState = MicState.denied;
          }

          if (!attendee.hasMic && !attendee.phoneAudio) {
            micState = MicState.missing;
          }

          const pack: Pick<Attendee, 'micDenied' | 'micState' | 'hasMic'> = { micDenied: null, micState: micState };

          if (micState === MicState.missing) {
            pack.hasMic = false;
          }

          return new UpdateMessageData(attId, pack);
        });

      if (updatedAttArray) {
        this.inst.updateEngine.updateAttendees(client, updatedAttArray);
      }
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'audios' })
  private setRecordedAudioState(client, data: RecordedMediaInterface) {
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

    const sharedAudioData = { ...data as RecordedMediaObject };

    if (data.state === RecordedMediaState.STOP) {
      this.stopRecordedAudio(roomId, data.meetingAssetID);
    } else {
      sharedAudioData.senderId = client.data.aid;
      sharedAudioData.timeStamp = new Date().getTime();

      room.recordedAudios[sharedAudioData.meetingAssetID] = new RecordedMediaObject(
        sharedAudioData.accumulatedTime,
        sharedAudioData.name,
        sharedAudioData.timeStamp,
        sharedAudioData.state,
        sharedAudioData.rate,
        sharedAudioData.fileUrl,
        sharedAudioData.meetingAssetID
      );

      if ( // INITIAL PLAY
        // if we play video and don't have set active component OR we have active component
        // BUT is different than wanted -> in this case Video Component
        // => set to wanted component
        (data as RecordedMediaInterface).state === RecordedMediaState.PLAY &&
        (Object.keys(this.inst.model.roomsIndex[sender.room].paneActiveCmp).length === 0) ||
        (Object.keys(this.inst.model.roomsIndex[sender.room].paneActiveCmp).length !== 0 &&
          (this.inst.model.roomsIndex[sender.room].paneActiveCmp[(data as RecordedMediaInterface).paneId] !==
            (data as RecordedMediaInterface).activeCmpName))
      ) {
        this.inst.layoutEngine.savePaneActiveCmp(client,
          new SavePaneActiveCmp(sender.id,
            (data as RecordedMediaInterface).paneId,
            ComponentNames.audiosCmp));
      }

      // Below is the case of PLAY OR PAUSE STATE
      this.inst.roomEngine.updateRoom(room.id, { recordedAudios: room.recordedAudios });
      this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.SET_RECORDED_AUDIO_STATE, sharedAudioData);
    }

  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'audios' })
  public stopRecordedAudio(roomId: string, meetingAssetID?: string) {
    const room = this.inst.model.roomsIndex[roomId];
    if (room.isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }
    room.recordedAudios = {};

    const sharedAudioData: any = {};
    sharedAudioData.state = RecordedMediaState.STOP;

    if (meetingAssetID) {
      sharedAudioData.meetingAssetID = meetingAssetID;
    }

    this.inst.roomEngine.update({ recordedAudios: room.recordedAudios, id: room.id });
    this.inst.roomEngine.sendToRoom(room.id, ClientConnectionAPI.SET_RECORDED_AUDIO_STATE, sharedAudioData);
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'audios' })
  public setRecordedAudioSpeed(client, data: any) {
    const senderId = client.data.aid;
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const roomId = sender.room;
    const room = this.inst.model.roomsIndex[roomId];

    if (!this.inst.roomEngine.isRoomPresenter(sender, roomId)) {
      return;
    }

    const speedObject = {};
    speedObject['senderId'] = senderId;
    speedObject['rate'] = data;

    // update recordedAudios (rate) property of Room
    const recordedAudioId = Object.keys(room.recordedAudios)[0];
    room.recordedAudios[recordedAudioId].rate = data;

    // TODO: uncomment this if we decide to implement this feature in group videos / audios
    // this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.SET_RECORDED_AUDIO_SPEED, speedObject, false);
  }

  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'audios' })
  private updateAudioTime(roomId, attendeeId) {
    const room = this.inst.roomEngine.getRoomById(roomId);
    let playedAudio = null;
    if (room && (Object.keys(room.recordedAudios).length)) {
      playedAudio = Object.values(room.recordedAudios)[0];
    }
    if (playedAudio) {
      const sharedAudioData = { ...playedAudio as RecordedMediaObject };
      const currentTimestamp = (new Date()).getTime();
      let accTime = sharedAudioData.accumulatedTime;

      if (sharedAudioData.state === 1) {
        accTime = sharedAudioData.accumulatedTime + (currentTimestamp - sharedAudioData.timeStamp);
      }
      this.inst.sendToAttendee(attendeeId, ClientConnectionAPI.MEDIA_TIME_SYNC, { roomId: room.id, playTime: accTime });
    }
  }
}
