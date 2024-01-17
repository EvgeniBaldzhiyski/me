import apm from 'elastic-apm-node/start';
import Meeting from '../Meeting';
import Client from '../../../utils/Client';
import { Attendee, AttendeeBase, ErrorCodes } from '@container/models';
import { gatewayScanner } from '../../../gateway/manager';
import { Subject } from 'rxjs';
import { createMongoDbStateManager, MongoDbStateManager } from '../../../database/MongoDbStateManager';
import { Collection } from 'mongodb';
import config from 'config';

/**
 * @interface
 * @export {BaseModuleInterface}
 */
export interface BaseModuleInterface {
  setup(): Promise<void>;
  destruct(code?: ErrorCodes): Promise<void>;
  beforeDestruct(code?: ErrorCodes): Promise<void>;

  approveAttendeeChange(client: Client | null, id: string, data: AttendeeBase, done?: (data: AttendeeBase) => void);
  approveRoomChange(client: Client | null, id: string, data: any, done?: (data: any) => void);

  onAddAttendee(a: Attendee);
  onRemoveAttendee(id: string);
}

export interface BaseModuleInterfaceStatic<R extends BaseModuleInterface = BaseModuleInterface> {
  new(inst: Meeting): R;
  isEnabled(inst: Meeting): boolean;
}

export interface StateInterface {
  updateTime?: number;
  meetingRunID?: string;
}

export default abstract class BaseModule implements BaseModuleInterface {
  protected destroyed$ = new Subject<undefined>();

  protected stateManager: MongoDbStateManager<StateInterface>;
  protected stateCollection: Collection;

  constructor(protected inst: Meeting) {
    gatewayScanner(this, this.inst.server, [ this.inst ]);
  }

  static isEnabled(inst: Meeting) {
    return true;
  }

  async setup() {
    if (this.stateCollection) {
      this.stateManager = await createMongoDbStateManager(this.stateCollection, this.inst.model.meetingID);
    }

    return Promise.resolve();
  }

  async destruct(code?: ErrorCodes) {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.inst = null;
    return Promise.resolve();
  }

  async beforeDestruct(code?: ErrorCodes) {
    return Promise.resolve();
  }

  approveAttendeeChange(client: Client | null, id: string, data: AttendeeBase, done?: (data: AttendeeBase) => void) { }
  approveRoomChange(client: Client | null, id: string, data: any, done?: (data: any) => void) { }

  onAddAttendee(a: Attendee) { }
  onRemoveAttendee(id: string) { }

  protected serializeState(): Promise<StateInterface> | StateInterface { return; }
  protected populateState(state: StateInterface) { }

  protected async loadState() {
    if (!this.stateManager) {
      throw new Error(`A state manager can't be found`);
    }

    const logger = this.inst.logger;
    try {
      const state = await this.stateManager.loadState();
      this.inst.logger.debug(`${this.constructor.name} state was loaded successfully`);

      if (state && this.isStateFresh(state)) {
        await this.populateState(state);
        this.inst.logger.debug(`${this.constructor.name} state was populated successfully`);
      }

      this.stateManager.deleteState();
      this.inst.logger.debug(`${this.constructor.name} used state was deleted successfully`);
    } catch (err) {
      apm.captureError(err);
      logger.error(`Error loading state for ${this.constructor.name} for meeting (${this.inst.model.meetingID})! ${err.message}`);
    }
  }

  protected async saveState() {
    if (!this.stateManager) {
      throw new Error(`A state manager can't be found`);
    }

    const logger = this.inst.logger;
    const updateTime = new Date().getTime();

    try {
      const state = await this.serializeState();
      if (state) {
        await this.stateManager.saveState({
          ...state,
          updateTime: state.updateTime || updateTime,
          meetingRunID: this.inst.model.meetingRunID
        });
        this.inst.logger.debug(`${this.constructor.name} state was saved successfully`);
      } else {
        this.inst.logger.debug(`${this.constructor.name} state was empty skip saving`);
      }
    } catch (err) {
      apm.captureError(err);
      logger.error(`Error saving state of ${this.constructor.name} meeting(${this.inst.model.meetingID}). ${err.message}`);
    }
  }

  protected isStateFresh(state: StateInterface): boolean {
    const now = new Date().getTime();
    const timeout = config.get<number>('socketServerConfig.roomKeepAlive') * 1000;

    return (now - state.updateTime <= timeout);
  }
}
