import { ApmSpan, ApmTransaction, FunctionalDomainType, TransactionType } from '@container/apm-utils';
import { AssetInterface, Model, RestAPI, Room, ServerRestAPI } from '@container/models';
import { Post } from '../../../../gateway/decorators/method.decorator';
import { res } from '../../../../gateway/decorators/argument.decorator';
import { coreApiObservable } from '../../../../utils/coreApiClient';
import { ServerResponse } from '../../../../utils/Server';
import { JwtSubjects } from '../../../../gateway/types';
import { Subject } from 'rxjs';

export class AssetGatewayEventAdd {
  constructor(public readonly changes: any) { }
}

export class AssetGatewayEventRemove {
  constructor(public readonly ids: AssetInterface['meetingAssetID'][]) { }
}

export type AssetGatewayEvent = AssetGatewayEventAdd | AssetGatewayEventRemove;

export class CoreApiAssetsClient {
  private events = new Subject<AssetGatewayEvent>();
  events$ = this.events.asObservable();

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.ASSETS, spanType: 'request' })
  setAssetReleasedStatus(
    rid: Room['id'],
    id: AssetInterface['meetingAssetID'],
    value: boolean,
    mid: Model['meetingID']
  ) {
    return coreApiObservable.put<void>(
      RestAPI.ASSETS,
      {
        mid,
        boRoomID: rid,
        meetingAssetID: id,
        isReleased: value
      }
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.ASSETS, spanType: 'request' })
  fetchAssets(
    rid: Room['id'],
    mid: Model['meetingID']
  ) {
    const params: any = {
      mid,
      refresh: 1
    };

    if (rid) {
      params.rid = rid;
    }

    return coreApiObservable.get<AssetInterface[]>(`${RestAPI.ASSETS}/RoomList`, { params });
  }

  /**
   * @UnderConstruction
   */
  @Post(ServerRestAPI.ASSETS_ADDED, [JwtSubjects.LEGACY_BACKEND])
  @ApmTransaction(TransactionType.REQUEST, { functionalDomain: FunctionalDomainType.ASSETS })
  onAssetChanged(@res res: ServerResponse, params: { Changes: any}) {
    res.send(200);

    this.events.next(new AssetGatewayEventAdd(params.Changes));
  }

  /**
   * @UnderConstruction
   */
  @Post(ServerRestAPI.ASSETS_REMOVED, [JwtSubjects.LEGACY_BACKEND])
  @ApmTransaction(TransactionType.REQUEST, { functionalDomain: FunctionalDomainType.ASSETS })
  onAssetRemoved(@res res: ServerResponse, params: { ids: string[]}) {
    res.send(200);

    this.events.next(new AssetGatewayEventRemove(params.ids));
  }
}
