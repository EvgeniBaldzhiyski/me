import apm from 'elastic-apm-node/start';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import { ChangeActivePaneComponent, RoomSettingsChangeEvent } from '../../events/SessionEvents';
import {
  Attendee,
  ComponentNames,
  SavePaneActiveCmp,
  ServerConnectionAPI,
  ClientConnectionAPI,
  Room
} from '@container/models';
import Client from '../../../../utils/Client';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import { CoreApiLayoutClient } from './layout.gateway';
import { catchError, filter, finalize, map, take, takeUntil } from 'rxjs/operators';
import { EMPTY, Observable, Subject } from 'rxjs';
import BaseModule from '../../modules/BaseModule';
import Meeting from '../../Meeting';

const ACTIVE_CMP_MAP = {
  // pane 1
  [ComponentNames.audiosCmp]: 'enableAudio',
  [ComponentNames.videosCmp]: 'enableVideo',
  [ComponentNames.webCamCmp]: 'enableWebcams',
  // pane 2
  [ComponentNames.documentsCmp]: 'enableDocuments',
  [ComponentNames.presentationsCmp]: 'enablePresentations',
  [ComponentNames.screenSharingCmp]: 'enableScreenShare',
};

export default class LayoutEngine extends BaseModule {
  private layoutsRegister: Map<Room['id'], any> = new Map();
  private fetchLayoutInProgress = new Set<Room['id']>();

  private newSettingsLoaded = new Subject<Room['id']>();

  constructor(
    protected inst: Meeting,
    private coreApiLayoutClient: CoreApiLayoutClient = new CoreApiLayoutClient()
  ) {
    super(inst);

    this.inst.eventBus.on(RoomSettingsChangeEvent.type, data => this.roomSettingsChangeEvent(data));
  }

  @Socket(ServerConnectionAPI.FOLLOW_ME)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private applyFollowMe(@client client: Client, data) {
    const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (this.inst.roomEngine.isRoomPresenter(a, a.room)) {
      const room = this.inst.roomEngine.getRoomById(a.room);

      if (room) {
        this.inst.roomEngine.updateRoom(room.id, { followMePane: data });
      }
    }
  }

  @Socket(ServerConnectionAPI.SAVE_LAYOUT)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private async applyLayout(@client client: Client, { roomid: rid, layout }: { roomid: Room['id'], layout: any }) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee || !this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      return;
    }

    const stringLayout = JSON.stringify(layout);
    const settings = this.layoutsRegister.get(rid);

    this.coreApiLayoutClient.applyLayout(rid, layout, this.inst.model.meetingID, this.inst.model.sessionSettings.hostID).subscribe({
      error: (err) => {
        apm.captureError(err.message, {
          custom: {
            mid: this.inst.model.meetingID,
            mrid: this.inst.model.meetingRunID,
            stack: err.stack
          }
        });
      }
    });

    if (settings) {
      this.beforeApplyNewSettings(rid, { ...settings, layout: stringLayout });
      this.deliverRoomSettingsTo(rid, this.layoutsRegister.get(rid), 'all');

      return;
    }

    this.loadLayoutSettings(rid).pipe(
      map(rid => this.layoutsRegister.get(rid))
    ).subscribe(settings => {
      this.beforeApplyNewSettings(rid, { ...settings, layout: stringLayout });
      this.deliverRoomSettingsTo(rid, this.layoutsRegister.get(rid), 'all');
    });
  }

  @Socket(ServerConnectionAPI.LOAD_LAYOUT)
  @ApmTransaction(TransactionType.WS_REQUEST)
  async onLoadLayoutSettings(@client client: Client, rid: Room['id']) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      return;
    }

    const settings = this.layoutsRegister.get(rid);

    if (settings) {
      if (attendee.room === rid) {
        this.inst.server.sendTo(ClientConnectionAPI.ROOM_LAYOUT_LOAD, { rid, settings }, client.id);
      }
      return;
    }

    this.loadLayoutSettings(rid).subscribe(rid =>
      this.deliverRoomSettingsTo(rid, this.layoutsRegister.get(rid))
    );
  }

  @Socket(ServerConnectionAPI.SAVE_PANE_ACTIVE_CMP)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onSavePaneActiveCmp(@client client:Client, data: SavePaneActiveCmp) {
    this.savePaneActiveCmp(client, data);
  }

  @Socket(ServerConnectionAPI.TOGGLE_BOTTOM_PANE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private toggleBottomPane(@client client: Client, value: boolean) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    // this is used only in 2 pane sessions
    if (!attendee || !attendee.hasBaton) {
      return;
    }

    this.inst.roomEngine.updateRoom(attendee.room, { hideBottomPane: value });
  }

  // @fixme - use SAVE_PANE_ACTIVE_CMP instead
  @Socket(ServerConnectionAPI.SET_DOCUMENT_COMPONENT)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private setDocumentComponent(@client client: Client) {
    this.savePaneActiveCmp(client, new SavePaneActiveCmp(client.data.aid, 2, ComponentNames.documentsCmp));
  }

  // @fixme - use SAVE_PANE_ACTIVE_CMP instead
  @Socket(ServerConnectionAPI.SET_PRESENTATION_COMPONENT)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private setPresentationComponent(@client client: Client) {
    this.savePaneActiveCmp(client, new SavePaneActiveCmp(client.data.aid, 2, ComponentNames.presentationsCmp))
  }

  @ApmTransaction(TransactionType.REQUEST)
  private roomSettingsChangeEvent(data: any[]) {
    for (const settings of data || []) {
      const { id: rid, ...cloneSettings } = settings;
      const layoutsSettings = this.layoutsRegister.get(rid);

      if (layoutsSettings) {
        this.beforeApplyNewSettings(rid, { ...layoutsSettings, ...cloneSettings });
        this.deliverRoomSettingsTo(rid, this.layoutsRegister.get(rid), 'all');
      } else if (this.fetchLayoutInProgress.has(rid)) {
        this.loadLayoutSettings(rid).pipe(
          map(rid => this.layoutsRegister.get(rid))
        ).subscribe(settings => {
          this.beforeApplyNewSettings(rid,  { ...settings, ...cloneSettings });
          this.deliverRoomSettingsTo(rid, this.layoutsRegister.get(rid), 'all');
        });
      }
    }
  }

  @ApmSpan()
  loadLayoutSettings(rid: Room['id']): Observable<Room['id']> {
    if (this.fetchLayoutInProgress.has(rid)) {
      return this.newSettingsLoaded.pipe(
        filter(roomid => roomid === rid),
        take(1)
      );
    }

    this.fetchLayoutInProgress.add(rid);

    this.coreApiLayoutClient.loadLayoutSettings(rid, this.inst.model.meetingID).pipe(
      takeUntil(this.destroyed$),
      finalize(() => {
        this.fetchLayoutInProgress.delete(rid);
      }),
      catchError(err => {
        apm.captureError(err.message, {
          custom: {
            mid: this.inst.model.meetingID,
            mrid: this.inst.model.meetingRunID,
            stack: err.stack
          }
        });
        return EMPTY;
      })
    ).subscribe(res => {
      if (res.data) {
        this.beforeApplyNewSettings(rid, res.data);

        this.newSettingsLoaded.next(rid);
      }
    });

    return this.newSettingsLoaded.pipe(
      filter(roomid => roomid === rid),
      take(1)
    );
  }

  // cover functionality "hide bottom bar"
  @ApmSpan()
  private manageHideBottomPaneFlag(rid, oldSettings, newSettings) {
    // set the default value for hideBottomPane, based on room layout
    const room = this.inst.roomEngine.getRoomById(rid);
    if (!room) {
      return;
    }

    let hideBottomValue = room.hideBottomPane;

    if (
      hideBottomValue === null || !oldSettings ||
      ( // if bottom bar is hidden but there has not board or some of pane 3 is enabled
        hideBottomValue && (
          !newSettings.enableWhiteboard ||
          newSettings.enableSurveys ||
          newSettings.enableImages
        )
      )
        ||
      ( // if bottom bar is visible but there has any change and board is enable but all in pane 3 are disabled
        !hideBottomValue &&
        newSettings.enableWhiteboard &&
        !newSettings.enableSurveys &&
        !newSettings.enableImages && (
          newSettings.enableWhiteboard !== oldSettings.enableWhiteboard ||
          newSettings.enableSurveys !== oldSettings.enableSurveys ||
          newSettings.enableImages !== oldSettings.enableImages
        )
      )
    ) {
      const pane1 = [newSettings.enableAudio, newSettings.enableVideo, newSettings.enableWebcams].some(i => !!i);
      const pane2 = [newSettings.enableDocuments, newSettings.enableScreenShare, newSettings.enablePresentations].some(i => !!i);
      const pane3 = [newSettings.enableImages, newSettings.enableSurveys].some(i => !!i);

      hideBottomValue = newSettings.enableWhiteboard && !pane3 && (pane1 || pane2);
    }

    if (room.hideBottomPane !== hideBottomValue) {
      this.inst.roomEngine.updateRoom(rid, { hideBottomPane: hideBottomValue });
    }
  }

  @ApmSpan()
  private deliverRoomSettingsTo(rid: Room['id'], data: any, to: 'room' | 'all' = 'room') {
    const settings = this.layoutsRegister.get(rid);

    if (!settings) {
      return;
    }

    try {
      this.manageHideBottomPaneFlag(rid, settings, data);
    } catch (err) {
      apm.captureError(err);
      this.inst.logger.error('LayoutEngine got error when manageHideBottomPaneFlag', err);
    }

    if (to === 'room') {
      this.inst.roomEngine.sendToRoom(rid, ClientConnectionAPI.ROOM_LAYOUT_LOAD, { rid, settings: settings });
    } else {
      this.inst.server.sendTo(ClientConnectionAPI.ROOM_LAYOUT_LOAD, { rid, settings: settings });
    }
  }

  private beforeApplyNewSettings(rid: string, newSettings: any) {
    const oldSettings = this.layoutsRegister.get(rid);
    this.layoutsRegister.set(rid, newSettings);
    try {
      this.manageHideBottomPaneFlag(rid, oldSettings, newSettings);
    } catch (err) {
      apm.captureError(err);
      this.inst.logger.error('LayoutEngine got error when manageHideBottomPaneFlag', err);
    }
  }

  async savePaneActiveCmp(client: Client, { paneId, activeCmpName }: SavePaneActiveCmp) {
    let attendee: Attendee;
    let room: Room;

    try {
      attendee = this.inst.model.attendeesIndex[client.data.aid];
      if (!attendee || !this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
        throw new Error('Attendee is missing, invalid requester');
      }

      room = this.inst.roomEngine.getRoomById(attendee.room);
      if (!room || (room.paneActiveCmp[paneId] === activeCmpName && paneId !== 3)) {
        throw new Error('Invalid target room');
      }

      if (!this.layoutsRegister.has(room.id)) {
        await this.loadLayoutSettings(room.id).toPromise();
      }

      const layoutSettings = this.layoutsRegister.get(room.id);
      const convertCmpToSetting = ACTIVE_CMP_MAP[activeCmpName];

      if (!layoutSettings[convertCmpToSetting]) {
        throw new Error('Invalid or disabled target component.');
      }
    } catch (err) {
      apm.captureError(err, {
        custom: {
          mid: this.inst.model.meetingID,
          mrid: this.inst.model.meetingRunID,
          requester: client.data,
          requestData: { paneId, activeCmpName }
        }
      });
      this.inst.logger.error(err.message, err);

      return;
    }

    if (paneId === 3 || paneId === 4) {
      // do nothing: Pane 3, 4 are local panes only
      return;
    }

    const paneActiveCmp = Object.assign(room.paneActiveCmp, { [paneId]: activeCmpName });

    this.inst.eventBus.emit(ChangeActivePaneComponent.type, new ChangeActivePaneComponent(paneId, activeCmpName, attendee.room));
    this.inst.roomEngine.updateRoom(room.id, { paneActiveCmp });
  }

  getLayoutsSetting(rid: Room['id'], name) {
    return (this.layoutsRegister.get(rid) || {})[name];
  }

  hasLayoutSettings(rid: Room['id']): boolean {
    return this.layoutsRegister.has(rid);
  }

  clearLayoutSettings(rid: Room['id']) {
    this.layoutsRegister.delete(rid);
  }
}
