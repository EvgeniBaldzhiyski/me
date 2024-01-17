import { AssetInterface, Room } from '@container/models';

export class AssetsLoadEvent {
  public index: Record<AssetInterface['meetingAssetID'], AssetInterface>;

  constructor(
    public rid: Room['id'],
    public assets: AssetInterface[],
  ) {
    this.index = {};

    for (const asset of this.assets) {
      this.index[asset.meetingAssetID] = asset;
    }
  }
}

export class AssetsUpdateEvent extends AssetsLoadEvent {
  constructor(
    public rid: Room['id'],
    public assets: AssetInterface[],
    public meta: {
      maid: AssetInterface['meetingAssetID'];
      data: Partial<AssetInterface>
    }
  ) {
    super(rid, assets);
  }
}

export class AssetsRemoveEvent extends AssetsLoadEvent {
  constructor(
    public rid: Room['id'],
    public assets: AssetInterface[],
    public ids: AssetInterface['meetingAssetID'][]
  ) {
    super(rid, assets);
  }
}

export class AssetsAddEvent extends AssetsUpdateEvent { }

export type AssetsEvent = AssetsLoadEvent | AssetsUpdateEvent | AssetsRemoveEvent | AssetsAddEvent;
