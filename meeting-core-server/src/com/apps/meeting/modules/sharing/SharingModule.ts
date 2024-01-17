import apm from 'elastic-apm-node/start';
import {
  Attendee,
  AttSharingRights,
  AttSharingState,
  ClientConnectionAPI,
  GridLayoutModes,
  Roles,
  Room,
  ScreenSharingData,
  ServerConnectionAPI,
  UpdateMessageData,
  ErrorCodes,
  AttendeeBase
} from '@container/models';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import Client from '../../../../utils/Client';
import Meeting from '../../Meeting';
import BaseModule from './../BaseModule';

export default class SharingModule extends BaseModule {
  private inProgress = {};
  private testRoomLogMessage = 'Unexpected Action in SharingModule for Test Room.';

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);

    this.inst.server.onSocket(ServerConnectionAPI.SET_SCREEN_SHARING_RIGHTS, (client, data) => this.setScreenSharingRights(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.SET_SCREEN_SHARING_STATE, (client, data) => this.setScreenSharingState(client, data));
    this.inst.server.onSocket(
      ServerConnectionAPI.SCREEN_SHARING_LAYOUT,
      (client, data: GridLayoutModes) => this.changeScreenSharingLayout(client, data)
    );
    this.inst.server.onSocket(ServerConnectionAPI.SET_MULTIPLE_SHARING, (client, data: any) => this.setMultipleSharing(client, data));
    this.inst.server.onSocket(
      ServerConnectionAPI.STOP_ALL_MULTIPLE_SHARING,
      (client, data: any) => this.stopAllMultipleSharing(client, data)
    );
    this.inst.server.onSocket(ServerConnectionAPI.REMOTE_ACCESS, (client, data: any) => this.onRemoteAccess(client, data));

    this.inst.server.onSocket(ServerConnectionAPI.SHARING_ANSWER, (client, data: any) => this.appAnswer(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.SHARING_REQUEST, (client, data: any) => this.appRequest(client, data));
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private appAnswer(client, data) {
    const a = this.inst.model.attendeesIndex[client.data._aid];

    if (a && a.app) {
      this.inst.sendToAttendee(a.id, ClientConnectionAPI.SHARING_ANSWER, data);
    } else {
      const custom = {
        appAttendeeId: client.data._aid,
        appCommand: ClientConnectionAPI.SHARING_ANSWER,
        data
      };
      const err = new Error('Attempted to send a  APP command, but there is no APP in the session.');

      apm.captureError(err, { custom });
      this.inst.logger.error(err.message, custom);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private appRequest(client, data) {
    const a = this.inst.model.attendeesIndex[client.data.aid];

    if (a && a.app) {
      this.inst.server.sendTo(ServerConnectionAPI.SHARING_REQUEST, data, a.app);
    } else {
      const custom = {
        appAttendeeId: client.data.aid,
        appCommand: ServerConnectionAPI.SHARING_REQUEST,
        data
      };
      const err = new Error('Attempted to send a  APP command, but there is no APP in the session.');

      apm.captureError(err, { custom });
      this.inst.logger.error(err.message, custom);
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private setScreenSharingRights(client, data: ScreenSharingData) {
    if (this.isGoodRequest(client.data.aid, data.id, 'screenSharingRights', data.screenSharingRights)) {
      this.inst.updateEngine.updateAttendee(client, data.id, { sharingRights: data.screenSharingRights });
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private setScreenSharingState(client, data: AttSharingState) {
    if (this.isGoodRequest(null, client.data.aid, 'sharingState', data)) {
      this.inst.updateEngine.updateAttendee(client, client.data.aid, { sharingState: data });
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private changeScreenSharingLayout(client, data: GridLayoutModes) {
    const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (a && this.isGoodSender(a.id, a.room)) {
      this.inst.roomEngine.updateRoom(a.room, { screenSharingLayout: data });
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private setMultipleSharing(client, data) {
    if (this.isGoodSender(client.data.aid, data.roomid)) {
      const updatepack = [];

      // deny multiple sharing
      if (!data.value) {
        const baton = this.inst.roomEngine.getRoomBaton(data.roomid);

        for (const a of Object.values(this.inst.model.attendeesIndex)) {
          if ((!baton || a.id != baton.id) && a.sharingRights) {
            updatepack.push(new UpdateMessageData(a.id, 'sharingRights', AttSharingRights.disabled));
          }
        }
      } else {

        const host: Attendee = this.inst.model.attendeesIndex[this.inst.model.sessionSettings.hostID];
        if (host && host.sharingRights != AttSharingRights.canShareWithAll) {
          updatepack.push(new UpdateMessageData(host.id, 'sharingRights', AttSharingRights.canShareWithAll));
        }

        const baton = this.inst.roomEngine.getRoomCoPresenter(data.roomid);
        if (baton && baton.sharingRights != AttSharingRights.canShareWithAll) {
          updatepack.push(new UpdateMessageData(baton.id, 'sharingRights', AttSharingRights.canShareWithAll));
        }
      }
      this.inst.roomEngine.updateRoom(data.roomid, { allowMultiSharings: data.value });

      if (updatepack.length) {
        this.inst.updateEngine.updateAttendees(client, updatepack);
      }
    }
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  stopAllMultipleSharing(client: Client, roomid: string) {
    if (this.isGoodSender(client.data.aid, roomid)) {
      const updatepack = [];

      for (const a of Object.values(this.inst.model.attendeesIndex)) {
        if ((a.sharingRights || a.sharingState) && a.room === roomid) {
          let pac: AttendeeBase = { sharingRights: AttSharingRights.disabled };
          if (a.hasBaton) {
            pac = { sharingState: AttSharingState.noSharing };
          }
          updatepack.push(new UpdateMessageData(a.id, pac));
        }
      }
      this.inst.updateEngine.updateAttendees(client, updatepack);
    }
  }

  private checkForRightsOwner(a: Attendee, roomid: string): Attendee {
    return Object.values(this.inst.model.attendeesIndex).find(att =>
      (!att.left && att.room == roomid && att.sharingRights != AttSharingRights.disabled && (!a || att.id != a.id))
    );
  }

  @ApmSpan()
  private isGoodRequest(senderId: string | null, updatedId: string, key: string, value: any): boolean {
    const a = this.inst.model.attendeesIndex[updatedId];
    if (!a || a[key] === value) {
      return false;
    }

    if (this.inst.roomEngine.getRoomById(a.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return false;
    }

    if (senderId) {
      if (!this.isGoodSender(senderId, a.room)) {
        return false;
      }
    }
    return true;
  }

  @ApmSpan()
  private isGoodSender(senderId: string, roomId: string): boolean {
    const s = this.inst.model.attendeesIndex[senderId];
    if (this.inst.roomEngine.getRoomById(roomId).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return false;
    }
    // if sender is host or is baton for the same room or the main room
    // (@UPDATAED - in main room Co-Presenter can manipulate attendees everywhere)
    return (s && (s.role == Roles.HOST || s.role == Roles.COHOST || (s.hasBaton && (s.room == '' || s.room == roomId))));
  }
  private canSenderShare(senderId): boolean {
    const s = this.inst.model.attendeesIndex[senderId];

    return (s && s.sharingRights !== AttSharingRights.disabled);
  }

  @ApmSpan()
  async approveAttendeeChange(client, id, data, done) {
    const a: Attendee = this.inst.model.attendeesIndex[id];

    let s: Attendee;
    if (client) {
      s = this.inst.model.attendeesIndex[client.data.aid];
    }

    if (data.app !== undefined) {
      if (data.app) {
        if (a.app) {
          this.inst.server.disconnect(a.app, ErrorCodes.KILL);
        }
      } else {
        if (client && client.id !== a.app) {
          return done(null);
        }
      }
    }

    let roomid: string = a.room;
    let postRequest: any[] = [];

    if (data.room !== undefined) {
      roomid = data.room;
    }
    const room = this.inst.roomEngine.getRoomById(roomid);
    const oldRoom: Room = this.inst.roomEngine.getRoomById(a.room);

    let baton: Attendee = this.inst.roomEngine.getRoomBaton(room.id);
    let rightsOwner: Attendee = this.checkForRightsOwner(a, room.id);

    this.inProgress[id] = {};

    if (!a || !room) {
      return done(null);
    }

    // ---------------- //
    // ---------------- //
    // ---------------- //

    if (data.role !== undefined && data.role !== a.role) {
      if (data.role === Roles.ATTENDEE) {
        if (a.sharingRights !== AttSharingRights.disabled) {
          data.sharingRights = AttSharingRights.disabled;
        }

        if (a.sharingState !== AttSharingState.noSharing) {
          data.sharingState = AttSharingState.noSharing;
        }

        if (rightsOwner && rightsOwner.id === a.id) {
          rightsOwner = null;
        }
      }
    }

    if (data.kickedOut !== undefined) {
      if (a.sharingRights !== AttSharingRights.disabled) {
        data.sharingRights = AttSharingRights.disabled;
      }
    }

    if (data.sharingState !== undefined) {
      if (s && !this.canSenderShare(s.id)) {
        delete this.inProgress[id];
        return done(data); // ADD UPDATE VETO!!!
      }
    }

    // ---------------- //
    // ---------------- //
    // ---------------- //

    if (data.sharingRights !== undefined) {
      if (s && !this.isGoodSender(s.id, room.id)) {
        delete this.inProgress[id];
        return done(data); // ADD UPDATE VETO!!!
      }

      if (!room.allowMultiSharings) {
        if (data.sharingRights) {

          // the baton (sender) give rigfhts to something else
          if (rightsOwner) {
            if (!this.inProgress[rightsOwner.id] && !this.inProgress[id][rightsOwner.id]) {
              this.inProgress[id][rightsOwner.id] = 1;
              postRequest = [rightsOwner.id, { sharingRights: AttSharingRights.disabled }];
            }
          }
        } else {
          // case when it use the sharing rights botton in toggle mode
          // fixing state
          if (a.sharingState == AttSharingState.sharing) {
            data.sharingState = AttSharingState.noSharing;
          }
          // !!!!! Check if does not have owner or if owner is me and if has baton then to give him !!!!!
          if (!rightsOwner && baton) {
            // if baton (not host) does the action is taking the right instead of the host.
            // This is in case if there has available host only.
            if (s && s.hasBaton && s.room === room.id) {
              baton = s;
            }

            if (!this.inProgress[baton.id] && !this.inProgress[id][baton.id]) {
              this.inProgress[id][baton.id] = 1;
              postRequest = [baton.id, { sharingRights: AttSharingRights.canShareWithAll }];
            }
          }
        }
      } else {
        if (data.sharingRights) {
          // fixing state
          if (a.sharingState == AttSharingState.sharing) {
            data.sharingState = AttSharingState.noSharing;
          }
        }
      }
    }

    // ---------------- //
    // ---------------- //
    // ---------------- //

    if (data.left !== undefined || data.room !== undefined || data.hasBaton !== undefined) {
      // @PERFORMANCE: - will do looping only if the room has not allowed multy sharing
      if (!room.allowMultiSharings) {
        if (data.left !== undefined) {
          if (rightsOwner) {
            if (a.sharingState) {
              data.sharingState = AttSharingState.noSharing;
            }
            if (a.sharingRights) {
              data.sharingRights = AttSharingRights.disabled;
            }
          } else {
            if (data.left) {
              if (baton && a.sharingRights !== AttSharingRights.disabled) {
                if (!this.inProgress[baton.id] && !this.inProgress[id][baton.id]) {
                  this.inProgress[id][baton.id] = 1;
                  postRequest = [baton.id, { sharingRights: AttSharingRights.canShareWithAll }];
                }
              }
            } else {
              if ((a.role == Roles.HOST || a.role == Roles.COHOST) && !a.sharingRights) {
                data.sharingRights = AttSharingRights.canShareWithAll;
              }
            }
          }
        }

        if (data.hasBaton !== undefined) {
          if (data.hasBaton && a.sharingRights !== AttSharingRights.canShareWithAll) {
            if (rightsOwner) {
              if (a.sharingState) {
                data.sharingState = AttSharingState.noSharing;
              }
              data.sharingRights = AttSharingRights.disabled;
            } else {
              data.sharingRights = AttSharingRights.canShareWithAll;
            }
          } else if (!data.hasBaton && a.sharingRights !== AttSharingRights.disabled) {
            data.sharingRights = AttSharingRights.disabled;
            if (s && (s.role === Roles.HOST || s.role === Roles.COHOST) && s.room === roomid && !s.left) {
              postRequest = [s.id, { sharingRights: AttSharingRights.canShareWithAll }];
            }
          }
        }

        // check if target room is single sharing and already has owner take rights from attendee is moving in it.
        if (data.room !== undefined) {
          if (rightsOwner && rightsOwner?.id !== a.id) {
            if (a.sharingState) {
              data.sharingState = AttSharingState.noSharing;
            }
            if (a.sharingRights) {
              data.sharingRights = AttSharingRights.disabled;
            }
          } else {
            if (!a.sharingRights && (data.hasBaton || a.hasBaton)) {
              data.sharingRights = AttSharingRights.canShareWithAll;
            }
          }
        }
      } else {
        if ((a.role === Roles.HOST || a.role === Roles.COHOST) && !a.sharingRights) {
          data.sharingRights = AttSharingRights.canShareWithAll;
        }
        if (data.hasBaton && a.sharingRights !== AttSharingRights.canShareWithAll) {
          data.sharingRights = AttSharingRights.canShareWithAll;
        }
      }
    }

    if (data.sharingState === AttSharingState.noSharing || data.sharingRights === AttSharingRights.disabled) {
      if (a.access) {
        data.access = '';
      }
    }

    if (data.room !== undefined && a.sharingState !== AttSharingState.noSharing) {
      data.sharingState = AttSharingState.noSharing;
    }

    if (!!data.left || data.room !== undefined) {
      const ur = [];
      for (const aa of Object.values(this.inst.model.attendeesIndex)) {
        if (a.room === aa.room && aa.access === a.id) {
          ur.push(new UpdateMessageData(aa.id, 'access', ''));
        }
      }
      if (ur.length) {
        this.inst.updateEngine.updateAttendees(client, ur);
      }
    }

    await done(data);

    if (data.room !== undefined) {
      if (oldRoom) {
        let oldBaton = this.inst.roomEngine.getRoomCoPresenter(oldRoom.id);

        if (!oldBaton) {
          oldBaton = this.inst.roomEngine.getRoomBaton(oldRoom.id);
        }

        if (oldBaton && oldBaton.sharingRights !== AttSharingRights.canShareWithAll) {
          const holderId = this.inst.roomEngine.getAllAttendeeIdsForRoom(oldRoom.id).find(aid => (
            aid !== oldBaton.id && this.inst.model.attendeesIndex[aid].sharingRights !== AttSharingRights.disabled
          ));

          if (!this.inst.model.attendeesIndex[holderId]) {
            this.inst.updateEngine.updateAttendee(null, oldBaton.id, { sharingRights: AttSharingRights.canShareWithAll });
          }
        }
      }
    }

    if (postRequest.length) {
      this.inst.updateEngine.updateAttendee(null, postRequest[0], postRequest[1]);
    }
    delete this.inProgress[id];
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onRemoteAccess(client, data) {
    const s: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const a: Attendee = this.inst.model.attendeesIndex[data.id];

    if (a && s && a.access === s.id && a.app) {
      this.parseAccessRequest(data, a.app);
    }
  }

  @ApmSpan()
  private parseAccessRequest(o, to) {
    let cmd = '';

    const x = parseInt(o.x, 10);
    const y = parseInt(o.y, 10);

    switch (o.type) {
      case 'keyup': {
        if (o.key === 8) {
          o.char = 0;
        }
        if (o.char) {
          cmd = 'keyRelease ' + o.key + ' ' + o.char;
        } else {
          cmd = 'keyRelease ' + o.key;
        }
        break;
      }
      case 'keydown': {
        if (o.key === 8) {
          o.char = 0;
        }
        if (o.char) {
          cmd = 'keyPress ' + o.key + ' ' + o.char;
        } else {
          cmd = 'keyPress ' + o.key;
        }
        break;
      }
      case 'mouseup': {
        cmd = 'mouseRelease ' + 16 + ' ' + x + ' ' + y;
        break;
      }
      case 'mousedown': {
        cmd = 'mousePress ' + 16 + ' ' + x + ' ' + y;
        break;
      }
      case 'contextmenu': {
        this.parseAccessRequest(Object.assign({}, o, { type: 'contextmenu-press' }), to);

        cmd = 'mouseRelease ' + 4 + ' ' + x + ' ' + y;
        break;
      }
      case 'contextmenu-press': {
        cmd = 'mousePress ' + 4 + ' ' + x + ' ' + y;
        break;
      }
      case 'mousemove': {
        cmd = 'mouseMove ' + x + ' ' + y;
        break;
      }
      case 'mousewheel': {
        cmd = 'mouseWheel ' + o.delta;
        break;
      }
    }
    if (cmd) {
      this.inst.server.sendTo(ServerConnectionAPI.SHARING_REQUEST, `doJavaAction ${cmd}`, to);
    }
  }
}
