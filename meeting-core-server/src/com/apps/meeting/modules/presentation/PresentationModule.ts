import apm from 'elastic-apm-node/start';
import BaseModule, { StateInterface } from './../BaseModule';
import Client from '../../../../utils/Client';
import { ApmSpan, ApmTransaction, FunctionalDomainType, TransactionType } from '@container/apm-utils';
import {
  ComponentNames, Room, AssetType, AssetInterface, AssetStatus,
  ServerConnectionAPI, ClientConnectionAPI, ErrorCodes, StatTypes, StatActions, Attendee
} from '@container/models';
import { AssetsPlayerPlayingItemDto } from '@container/models/AssetsPlayer';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import { DB_COLLECTIONS, defaultDb } from '../../../../database';
import { ChangeActivePaneComponent } from '../../events/SessionEvents';
import { AssetsLoadEvent } from '../../engines/assets/assets.events';
import { filter, takeUntil } from 'rxjs/operators';
import config from 'config';

interface StateItemInterface {
  rid: Room['id'];
  activeCmp: ComponentNames;
  annotationState: boolean;

  playingItem: Record<AssetType.Document | AssetType.Presentation,
    AssetInterface['meetingAssetID']
  >;
  items: Record<AssetInterface['meetingAssetID'], AssetsPlayerPlayingItemDto>;
}
interface PresentationModuleState extends StateInterface {
  records: StateItemInterface[];
}

interface PresentationsModuleStore {
  playingItem: Record<AssetType.Document | AssetType.Presentation,
    AssetInterface['meetingAssetID']
  >;
  items: Record<AssetInterface['meetingAssetID'], AssetsPlayerPlayingItemDto>;
  annotationEnable: boolean;
}

export default class PresentationModule extends BaseModule {
  private presentationsStore: Map<Room['id'], PresentationsModuleStore> = new Map();
  protected stateCollection = defaultDb().collection(DB_COLLECTIONS.PRESENTATION_MODULE_STATES);

  private stateBeforeSave: ErrorCodes;

  async setup() {
    await super.setup();

    this.inst.eventBus.on(ChangeActivePaneComponent.type, event => this.onChangeActivePane(event));

    this.inst.assetsEngine.event$.pipe(
      filter(event => event instanceof AssetsLoadEvent),
      takeUntil(this.destroyed$)
    ).subscribe(
      event => this.onAssetChanged(event as AssetsLoadEvent)
    );

    await this.loadState();

    return Promise.resolve();
  }

  async beforeDestruct(code) {
    this.stateBeforeSave = code;
    await this.saveState();

    return super.beforeDestruct(code);
  }

  @Socket(ServerConnectionAPI.GET_PLAYING_ITEM)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private getPlayingItem(@client client: Client, { assetType }: { assetType: AssetType.Presentation | AssetType.Document }) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    const storage = this.presentationsStore.get(attendee.room) || this.createStoreItem(attendee.room);

    const playingItemId = storage.playingItem[assetType];
    const playingItemDto = storage.items[playingItemId];

    if (playingItemDto) {

      if (!playingItemDto.senderId && this.canSendCommand(attendee)) {
        playingItemDto.senderId = attendee.id;
      }

      this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.GET_PLAYING_ITEM, playingItemDto);
    }
  }

  @Socket(ServerConnectionAPI.GET_ANNOTATION_MODE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private getAnnotationMode(@client client: Client) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      return;
    }

    const storage = this.presentationsStore.get(attendee.room) || this.createStoreItem(attendee.room);

    this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.GET_ANNOTATION_MODE, storage.annotationEnable);
  }

  @Socket(ServerConnectionAPI.GET_CMP_DETAILS)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private getComponentDetails(@client client: Client, { assetType }: { assetType: AssetType.Document | AssetType.Presentation }) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      return;
    }

    const storage = this.presentationsStore.get(attendee.room) || this.createStoreItem(attendee.room);

    this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.GET_PLAYING_ITEM, {
      playingItem: storage.playingItem[assetType],
      item: storage.items[storage.playingItem[assetType]]
    });
  }

  @Socket(ServerConnectionAPI.SET_PLAYING_ITEM)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private setPlayingItem(@client client: Client, { meetingAssetId }: {meetingAssetId: AssetInterface['meetingAssetID']}) {
    if (meetingAssetId === undefined) {
      return;
    }

    const attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee && !this.canSendCommand(attendee)) {
      return;
    }

    const asset = this.inst.assetsEngine.getAssets(attendee.room).find(a => a.meetingAssetID === meetingAssetId);

    if (!asset) {
      apm.captureError(new Error('The asset that is trying to make as playing items does not exist'), {
        custom: {
          meetingID: this.inst.model.meetingID,
          meetingRunID: this.inst.model.meetingRunID,
          meetingAssetId
        }
      });

      return;
    }

    const type = asset.assetType as AssetType.Document | AssetType.Presentation;
    const playingItemDto = this.setPlayItem(attendee.room, type, meetingAssetId);

    playingItemDto.senderId = attendee.id;

    this.inst.roomEngine.sendToRoom(attendee.room, ClientConnectionAPI.GET_PLAYING_ITEM, playingItemDto);
  }

  @Socket(ServerConnectionAPI.SET_PLAYING_ITEM_PAGE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private setPlayingItemPage(
    @client client: Client,
    { meetingAssetId, page, step }: {meetingAssetId: string;  page: number; step: number}
  ) {
    if (![page, step, meetingAssetId].every((prop) => prop !== undefined)) {
      return;
    }

    const attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee || !this.canSendCommand(attendee)) {
      return;
    }

    const storage = this.presentationsStore.get(attendee.room) || this.createStoreItem(attendee.room);

    let maxPages = 1;
    if (!storage.items[meetingAssetId]) {
      const asset = this.inst.assetsEngine.getAssets(attendee.room).find(a => a.meetingAssetID === meetingAssetId);

      if (!asset) {
        apm.captureError(new Error('There has a try to set page for unknown asset'), {
          custom: {
            meetingID: this.inst.model.meetingID,
            meetingRunID: this.inst.model.meetingRunID,
            meetingAssetId
          }
        });

        return;
      }

      maxPages = asset.numDocumentsPages;
    } else {
      maxPages = storage.items[meetingAssetId].maxPages;
    }

    if (storage.items[meetingAssetId].page === page && storage.items[meetingAssetId].step === step) {
      // @todo SET AUDIT WARNING LOG
      return;
    }

    if (page < 1 || page > maxPages) {
      // @todo SET AUDIT WARNING LOG
      return;
    }

    const playingItemDto = storage.items[meetingAssetId] = new AssetsPlayerPlayingItemDto(
      meetingAssetId,
      attendee.id,
      page,
      step,
      maxPages
    );

    this.inst.roomEngine.sendToRoom(attendee.room, ClientConnectionAPI.SET_PLAYING_ITEM_PAGE, playingItemDto);
  }

  @Socket(ServerConnectionAPI.SET_ANNOTATION_MODE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private setAnnotationMode(@client client: Client, state: boolean ) {
    if (state === undefined) {
      return;
    }

    const attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee && !this.canSendCommand(attendee)) {
      return;
    }

    const storage = this.presentationsStore.get(attendee.room) || this.createStoreItem(attendee.room);

    storage.annotationEnable = state;

    this.inst.roomEngine.sendToRoom(attendee.room, ClientConnectionAPI.GET_ANNOTATION_MODE, storage.annotationEnable);
  }

  @ApmSpan()
  private createStoreItem(rid: Room['id']): PresentationsModuleStore {
    const storageItem = this.presentationsStore.set(rid, {
      playingItem: {
        [AssetType.Document]: '',
        [AssetType.Presentation]: ''
      },
      items: {},
      annotationEnable: false,
    });

    this.setPlayItem(rid, AssetType.Presentation);
    this.setPlayItem(rid, AssetType.Document);

    return storageItem.get(rid);
  }

  @ApmSpan()
  private setPlayItem(rid: Room['id'], type: AssetType.Document | AssetType.Presentation, iid?: AssetInterface['meetingAssetID']) {
    const storage = this.presentationsStore.get(rid) || this.createStoreItem(rid);

    if (iid && storage.playingItem[type] === iid) {
      return storage.items[iid];
    }

    const assets = this.inst.assetsEngine.getAssets(rid, type);
    const specificItem = assets.find(a =>
      (!iid || a.meetingAssetID === iid) && a.assetType === type && a.status === AssetStatus.ReadyForUse
    );

    if (!specificItem) {
      return;
    }

    storage.playingItem[type] = specificItem.meetingAssetID;

    if (!storage.items[specificItem.meetingAssetID]) {
      storage.items[specificItem.meetingAssetID] = new AssetsPlayerPlayingItemDto(
        specificItem.meetingAssetID,
        '',
        1,
        0,
        specificItem.numDocumentsPages
      );
    }

    const statType =  type === AssetType.Document ? StatTypes.DOCUMENT : StatTypes.PRESENTATION;
    this.inst.statisticsEngine.send(rid, statType, StatActions.OPEN, specificItem.meetingAssetID);

    return storage.items[specificItem.meetingAssetID];
  }

  private canSendCommand(attendee: Attendee) {
    return this.inst.roomEngine.isHost(attendee) ||
        this.inst.roomEngine.isCoHost(attendee) ||
        this.inst.roomEngine.isRoomPresenter(attendee, attendee.room);
  }

  private onAssetChanged({ rid, index }: AssetsLoadEvent) {
    const storage = this.presentationsStore.get(rid);

    if (!storage) {
      return;
    }

    for (const id in storage.items) {
      if (!index[id]) {
        delete storage.items[id];
      }
    }

    for (const type of [AssetType.Document, AssetType.Presentation]) {
      const playingItemId = storage.playingItem[type];

      if (!index[playingItemId]) {
        storage.playingItem[type] = '';

        this.setPlayItem(rid, type as AssetType.Presentation | AssetType.Document);
      }
    }
  }

  private onChangeActivePane({ paneId, roomId: rid, newActiveComponent }: ChangeActivePaneComponent) {
    if (paneId === 2) {
      const storage = this.presentationsStore.get(rid);

      if (!storage) {
        return;
      }

      if (
        (newActiveComponent === ComponentNames.documentsCmp && storage.playingItem[AssetType.Document]) ||
        (newActiveComponent === ComponentNames.presentationsCmp && storage.playingItem[AssetType.Presentation])
      ) {
        const statType =  newActiveComponent === ComponentNames.documentsCmp ? StatTypes.DOCUMENT : StatTypes.PRESENTATION;
        const assetType =  newActiveComponent === ComponentNames.documentsCmp ? AssetType.Document : AssetType.Presentation;

        this.inst.statisticsEngine.send(rid, statType, StatActions.OPEN, storage.playingItem[assetType]);
      }

      storage.annotationEnable = false;
    }
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'presentations' })
  protected populateState({ records, updateTime }: PresentationModuleState) {
    if (!records) {
      // in case the stored state was in old format, just skip using it
      // this was leading to `records is not iterable`
      // https://kb.prod.interactive.net/app/apm/services/-socket-server/errors/4a7fa79941c1f1d2a0b9697d35038558?kuery=&rangeFrom=2021-10-30T14:30:00.000Z&rangeTo=2021-11-01T10:10:11.282Z&environment=prod
      return;
    }
    const timeout = config.get<number>('socketServerConfig.roomKeepAlive') * 1000;
    const isFresh = (Date.now() - updateTime <= timeout);

    for (const {rid, activeCmp, items, playingItem, annotationState} of records) {
      const room = this.inst.model.roomsIndex[rid];

      if (!room) {
        continue;
      }

      const storage = this.presentationsStore.get(room.id) || this.createStoreItem(room.id);

      storage.items = items;
      storage.playingItem = playingItem;
      storage.annotationEnable = (isFresh ? annotationState : false);

      for (const [type, assetId] of Object.entries(storage.playingItem)) {
        const statType = type === AssetType.Document.toString() ? StatTypes.DOCUMENT : StatTypes.PRESENTATION;

        if (
          (type === AssetType.Document.toString() && activeCmp === ComponentNames.documentsCmp) ||
          (type === AssetType.Presentation.toString() && (!activeCmp || activeCmp === ComponentNames.presentationsCmp))
        ) {
          this.inst.statisticsEngine.send(rid, statType, StatActions.OPEN, assetId);
        }
      }

      this.inst.roomEngine.updateRoom(room.id, {
        paneActiveCmp: { ...room.paneActiveCmp, 2: activeCmp }
      }, true);
    }
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.ASSETS, assetType: 'presentations' })
  protected serializeState(): PresentationModuleState {
    const records: PresentationModuleState['records'] = [];

    for (const room of Object.values(this.inst.model.roomsIndex)) {
      const storage = this.presentationsStore.get(room.id);

      if (storage) {
        records.push({
          rid: room.id,
          activeCmp: room.paneActiveCmp[2],
          items: storage.items,
          playingItem: storage.playingItem,
          annotationState: (this.stateBeforeSave !== ErrorCodes.SERVER_RESTART ? false : storage.annotationEnable),
        });
      }
    }

    return records.length ? { records } : null;
  }

  protected isStateFresh(_: PresentationModuleState): boolean {
    return true;
  }
}
