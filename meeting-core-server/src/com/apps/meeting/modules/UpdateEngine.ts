import apm from 'elastic-apm-node/start';
import Client from '../../../utils/Client';
import BaseModule, { BaseModuleInterface } from './BaseModule';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import { ClientConnectionAPI, ServerConnectionAPI, UpdateMessageData, AttendeeBase } from '@container/models';
import { Socket } from '../../../gateway/decorators/method.decorator';
import { client } from '../../../gateway/decorators/argument.decorator';
import { auditLogger } from '../../../logger/AuditLogger';
import { v4 } from 'uuid';
import { AttendeeUpdateEvent } from '../events/SessionEvents';

/**
 * End point for attendee updating.
 */
export default class UpdateEngine extends BaseModule {
  private approvers = [];

  private readonly editableProperties = new Set<keyof AttendeeBase>([
    'micState',
    'camState',
    'sharingState',
    'browserName',
    'browserVersion',
    'osName',
    'osVersion',
    'isOutdatedBrowser',
    'device',
    'isAway',
    // 'mediaConnStrength',
    'pttState',
    'phoneLocked',
    // this is used by the  desktop application
    'access',
  ]);

  destruct() {
    this.approvers = [];

    return super.destruct();
  }

  /**
   * @deprecated
   */
  @Socket(ServerConnectionAPI.UPDATE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onSocketUpdate(@client client: Client, data: UpdateMessageData | UpdateMessageData[]) {
    const attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      const err = new Error('invalid client try to start update process');
      apm.captureError(err, {
        custom: {
          meetingID: this.inst.model.meetingID,
          meetingRunID: this.inst.model.meetingRunID,
          clientData: client.data,
          updateData: data,
          lifeCycleState: this.inst.lifeCycleState
        }
      });
      this.inst.logger.error(err);

      return;
    }

    if (data instanceof Array) {
      this.sanitizeUpdateData(data);
      this.updateAttendees(client, data);
    } else {
      this.sanitizeUpdateData([data]);
      this.updateAttendee(client, data.id, data.data);
    }
  }

  registerApprover(approver: BaseModuleInterface) {
    this.approvers.push(approver);
  }

  removeApprover(approver: BaseModuleInterface) {
    for (var i = 0; i < this.approvers.length; i++) {
      if (this.approvers[i] === approver) {
        return this.approvers.splice(i, 1);
      }
    }
  }

  @ApmSpan()
  async updateAttendee(client: Client | null, id: string, data: AttendeeBase, missApproving = false) {
    await this.updateAttendees(client, [{ id, data }], missApproving);
  }

  @ApmSpan()
  async updateAttendees(client: Client | null, list: UpdateMessageData[], missApproving = false) {
    if (!list || !list.length) {
      return;
    }

    let dataApplyResolver;
    const dataApplyPromise = new Promise<void>(resolve => dataApplyResolver = resolve);

    let validList: UpdateMessageData[];
    
    if (!missApproving) {
      validList  = await Promise.all(list.map(({ id, data }: UpdateMessageData) => {
        return this._approveAndApplyData(client, id, data, dataApplyPromise);
      }));
    } else {
      for (const { id, data } of list) {
        this.applyData(id, data);
      }
      validList = list;
    }

    const filteredList = validList.filter(item => item !== null);

    if (filteredList.length) {
      this.inst.server.sendTo(ClientConnectionAPI.UPDATE, filteredList);
    }

    this.inst.logger.debug(`-= * PACKAGE OF CLIENTS HAVE BEEN UPDATE * =-`, { updateAttendeesData: filteredList });

    dataApplyResolver();
  }

  @ApmSpan()
  async approveAndApplyData(client: Client | null, { id, data }: UpdateMessageData): Promise<UpdateMessageData> {
    let dataApplyResolver;
    const dataApplyPromise = new Promise<void>(resolve => dataApplyResolver = resolve);

    const updateMessageData = await this._approveAndApplyData(client, id, data, dataApplyPromise);

    dataApplyResolver();

    return updateMessageData;
  }

  @ApmSpan()
  async approveData(client: Client | null, id: string, data: any, dataApplyPromise: Promise<void>): Promise<any> {
    if (!this.approvers.length) {
      return data;
    }

    for (const watcher of this.approvers) {
      data = await this.runApprover(watcher, client, id, data, dataApplyPromise);

      if (data === null) {
        break;
      }
    }

    this.inst.eventBus.emit(AttendeeUpdateEvent.type, new UpdateMessageData(id, data));
    return data;
  }

  private async _approveAndApplyData(client: Client | null, id: string, data: any, dataApplyPromise: Promise<void>): Promise<UpdateMessageData> {
    let returnData = null;

    const tmpId = v4();

    auditLogger.info(
      `(Start) Executing update sequence from ${this.inst.type}.${this.inst.name} for ${tmpId}.${id}, ` +
      `updating [${Object.keys(data)}], total update length = ${JSON.stringify(Object.values(data)).length}`
    );
    const validData = await this.approveData(client, id, data, dataApplyPromise);

    if (validData !== null) {
      this.applyData(id, validData);

      returnData = new UpdateMessageData(id, validData);
    }

    auditLogger.info(
      `(END) Executing update sequence from ${this.inst.type}.${this.inst.name} for ${tmpId}.${id}, ` +
      `updating [${Object.keys(data)}], total update length = ${JSON.stringify(Object.values(data)).length}`
    );

    return returnData;
  }

  private applyData(id: string, data: any) {
    this.inst.attendeeStorage.updateAttendee(id, data);
  }

  private async runApprover(
    approver: BaseModuleInterface,
    client: Client | null,
    id: string,
    data: any,
    dataApplyPromise: Promise<void>
  ): Promise<any> {
    return new Promise(resolve => {
      approver.approveAttendeeChange(client, id, data, d => {
        // if data is object then use reference
        if (typeof data !== 'object' || d === null) {
          data = d;
        }

        resolve(data);

        return dataApplyPromise;
      });
    });
  }

  private sanitizeUpdateData(updates: UpdateMessageData[]) {
    for (const update of updates) {
      for (const property of Object.keys(update.data)) {
        if (!this.editableProperties.has(property as keyof AttendeeBase)) {
          this.inst.logger.warn(`Attempt to update readonly field "${property}", by user id "${update.id}"`);
          delete update.data[property];
        }
      }
    }
  }
}
