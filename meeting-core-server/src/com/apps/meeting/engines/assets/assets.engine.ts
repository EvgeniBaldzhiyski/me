import apm from 'elastic-apm-node/start';
import {
  ClientConnectionAPI,
  ServerConnectionAPI,
  AssetInterface,
  Room,
  AssetType,
  UpdateInterfaceDto,
} from '@container/models';
import { ApmTransaction, FunctionalDomainType, TransactionType } from '@container/apm-utils';
import Meeting from '../../Meeting';
import BaseModule from '../../modules/BaseModule';
import Client from '../../../../utils/Client';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import { CoreApiAssetsClient } from './assets.gateway';
import { finalize, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { AssetsEvent, AssetsLoadEvent, AssetsUpdateEvent } from './assets.events';
import { MeetingMessagingCommands } from '../../events/MessagingAPI';

export default class AssetsEngine extends BaseModule {
  private assetRegister: Map<Room['id'], Array<AssetInterface>> = new Map();
  private fetchAssetsInProgress = new Set<Room['id']>();

  private event = new Subject<AssetsEvent>();
  event$ = this.event.asObservable();

  constructor(
    protected inst: Meeting,
    protected coreApiAssetsClient: CoreApiAssetsClient = new CoreApiAssetsClient()
  ) {
    super(inst);


    this.inst.server.onMessage(MeetingMessagingCommands.ASSET_UPDATE, ({ data }) => this.onAssetUpdate(data));
  }

  hasAssets(rid: Room['id']) {
    return !!this.assetRegister.get(rid);
  }

  getAssets(rid: Room['id'], filter?: AssetType): Array<AssetInterface> {
    return (this.assetRegister.get(rid) || []).filter(asset => !filter || asset.assetType === filter);
  }

  loadAssets(rid: Room['id']) {
    if (this.fetchAssetsInProgress.has(rid)) {
      return;
    }

    this.fetchAssetsInProgress.add(rid);

    this.coreApiAssetsClient.fetchAssets(rid, this.inst.model.meetingID).pipe(
      takeUntil(this.destroyed$),
      finalize(() => {
        this.fetchAssetsInProgress.delete(rid);
      })
    ).subscribe(
      res => {
        this.assetRegister.set(rid, (res?.data || []).map(asset => {
          if (
            asset.assetType === AssetType.Document ||
            (asset.assetType === AssetType.Presentation && asset.convertedFileExt !== 'html')
          ) {
            asset.imageFileUrl = `${asset.fileUrl.replace('.pdf', '')}/Images/${asset.companyAssetID}_00{PAGE_INDEX}.png`;
          }

          if (asset.assetType === AssetType.Presentation && asset.convertedFileExt === 'html') {
            asset.imageFileUrl = `${asset.fileUrl.replace(/[^\/]+$/, '')}/data/Thumbnails/Slide{PAGE_INDEX}.png`;
          }

          return asset;
        }));

        this.event.next(new AssetsLoadEvent(rid, this.assetRegister.get(rid)));
        this.inst.roomEngine.sendToRoom(rid, ClientConnectionAPI.GET_ASSETS, { rid, assets: this.assetRegister.get(rid) });
      },
      err => {
        const custom = {
          mid: this.inst.model.meetingID,
          mrid: this.inst.model.meetingRunID
        };

        apm.captureError(err, { custom });
        this.inst.logger.error(`Failed loading room assets. ${err.message}`, custom);
      }
    );
  }

  @Socket(ServerConnectionAPI.ASSET_UPDATE)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS })
  private releaseAsset(@client client: Client, { rid, id, value }: {
    id: AssetInterface['meetingAssetID'],
    rid: Room['id'],
    value: boolean
  }) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee || !this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      return;
    }

    const room = this.inst.roomEngine.getRoomById(rid || attendee.room);
    if (!room || room.isTestRoom) {
      this.inst.logger.debug('Unexpected Action in AssetsModule for Test Room.');
      return;
    }

    this.coreApiAssetsClient.setAssetReleasedStatus(room.id, id, value, this.inst.model.meetingID).subscribe({
      error: (err) => {
        const custom = {
          mid: this.inst.model.meetingID,
          mrid: this.inst.model.meetingRunID
        };

        apm.captureError(err, { custom });
        this.inst.logger.error(`Failed releasing an asset. ${err.message}`, custom);
      }
    });

    const dto = { rid, maid: id, data: {isReleased: value} };

    const changedAsset = this.assetUpdate(dto);

    this.sendUpdateEvents(changedAsset, dto);

    if (changedAsset && room.id) {
      this.inst.server.sendMessage(MeetingMessagingCommands.ASSET_UPDATE, dto);
    }
  }

  @Socket(ServerConnectionAPI.GET_ASSETS)
  @ApmTransaction(TransactionType.WS_REQUEST, { functionalDomain: FunctionalDomainType.ASSETS })
  private onLoadAssets(@client client: Client, { rid, fresh }: {
    rid: Room['id'],
    fresh: boolean
  }) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      return;
    }

    const assets = fresh ? null : this.assetRegister.get(rid);

    if (assets) {
      if (attendee.room === rid) {
        this.inst.server.sendTo(ClientConnectionAPI.GET_ASSETS, { rid, assets }, client.id);
      }

      return;
    }

    this.loadAssets(rid);
  }

  @ApmTransaction(TransactionType.REQUEST, { functionalDomain: FunctionalDomainType.ASSETS })
  private onAssetUpdate(dto: UpdateInterfaceDto) {
    const changedAsset = this.assetUpdate(dto);

    this.sendUpdateEvents(changedAsset, dto);
  }

  private assetUpdate({ rid, maid, data }: UpdateInterfaceDto): AssetInterface {
    rid = rid || '';

    let changedAsset;

    const assets = this.assetRegister.get(rid) || [];

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];

      if (asset.meetingAssetID === maid) {
        changedAsset = assets[i] = {...asset, ...data};
        break;
      }
    }

    return changedAsset;
  }

  private sendUpdateEvents(changedAsset: AssetInterface, { rid, maid, data }: UpdateInterfaceDto) {
    if (changedAsset) {
      rid = rid || '';

      this.event.next(new AssetsUpdateEvent(rid, this.assetRegister.get(rid), {
        maid: changedAsset.meetingAssetID,
        data: changedAsset
      }));

      this.inst.roomEngine.sendToRoom(rid, ClientConnectionAPI.ASSET_UPDATE, { rid, maid, data });
    }
  }
}
