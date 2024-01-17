import BaseModule from '../../BaseModule';
import { Get, Socket } from '../../../../../gateway/decorators/method.decorator';
import {
  Attendee,
  BoxWorkerReason,
  BoxWorkerStatus,
  ClientConnectionAPI,
  ErrorCodes,
  Roles,
  Room,
  ServerConnectionAPI,
  ServerRestAPI,
  SsrWorkerState
} from '@container/models';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import Client from '../../../../../utils/Client';
import { client } from '../../../../../gateway/decorators/argument.decorator';
import { fromEvent, merge, Subscription } from 'rxjs';
import { filter, takeUntil, tap } from 'rxjs/operators';
import { RoomRefreshEvent, SessionEventTypes } from '../../../events/SessionEvents';
import { DB_COLLECTIONS, defaultDb } from '../../../../../database';
import { BoxWorkerMongodbSchema } from '../utils/workers/box.worker.interface';
import { SsrWorker } from './ssr.worker';
import { SsrWorkerPayload } from './ssr.worker.interface';
import v4 from 'uuid/v4';
import Meeting from '../../../Meeting';
import config from 'config';

export default class SsrModule extends BaseModule {
  protected stateCollection = defaultDb().collection(DB_COLLECTIONS.SSR_MODULE_STATE);
  private workerStore: Map<Room['id'], { worker: SsrWorker, subscriptions: Subscription }> = new Map();
  private playlistsMap: Map<Room['id'], string> = new Map();

  get enableRecordingNotification() {
    return this.inst.model.sessionSettings.enableRecordingNotification;
  }

  static isEnabled(inst: Meeting): boolean {
    return inst.model.sessionSettings.allowRecording;
  }

  async setup(): Promise<void> {
    await super.setup();
    await this.loadState();
    this.inst.updateEngine.registerApprover(this);
    this.bindModuleEvents();
    return Promise.resolve();
  }

  async beforeDestruct(code?: ErrorCodes) {
    if (code === ErrorCodes.SERVER_RESTART) {
      await this.saveState();
    }

    this.workerStore.forEach(({worker}) => {
      this.stopWorker(worker.id);
    });
    return super.beforeDestruct(code);
  }

  @ApmSpan()
  async approveAttendeeChange(client, id, data, done) {
    const attendee = this.inst.model.attendeesIndex[id];
    const fromRoomId = this.inst.model.roomsIndex[attendee?.room]?.id;

    if (!fromRoomId && fromRoomId !== '' || !attendee) {
      return done(data);
    }

    await done(data);

    if (('left' in data)) {
      this.toggleWorkerForRoom(fromRoomId);
    }

    if (('kickedOut' in data)) {
      this.toggleWorkerForRoom(fromRoomId, id);
    }

    if ('room' in data) {
      const toRoomId = this.inst.model.roomsIndex[data?.room]?.id;

      if (!toRoomId && toRoomId !== '') {
        return;
      }

      this.toggleWorkerForRoom(toRoomId);
      this.toggleWorkerForRoom(fromRoomId);
    }
  }

  @ApmSpan()
  protected populateState({workers}: BoxWorkerMongodbSchema<SsrWorkerPayload>): void {
    for (const payload of workers) {
      this.playlistsMap.set(payload.id, payload.playlistId);
      this.createWorker(payload, BoxWorkerStatus.PAUSE);
    }
  }

  @ApmSpan()
  protected serializeState(): BoxWorkerMongodbSchema<SsrWorkerPayload> | null {
    const workers: SsrWorkerPayload[] = [];

    this.workerStore.forEach(({worker}) => {
      if (worker.getState().status !== BoxWorkerStatus.STOP) {
        workers.push(worker.payload);
      }
    });

    return workers.length ? {workers} : null;
  }

  private bindModuleEvents(): void {
    merge(
      fromEvent(this.inst.eventBus, SessionEventTypes.NO_MAIN_PRESENTER).pipe(
        tap((isPresenterAvailable: boolean) => this.toggleAllWorkersForAllRooms(isPresenterAvailable))
      ),
      fromEvent(this.inst.eventBus, SessionEventTypes.ROOM_BEFORE_CLOSE).pipe(
        tap((rid: Room['id']) => (this.stopWorker(rid)))
      ),
      fromEvent(this.inst.eventBus, RoomRefreshEvent.type).pipe(
        filter((rooms: Room[]) => rooms.filter(r => ('autoRecording' in r) && r.autoRecording).length > 0),
        tap((rooms: Room[]) => this.initiateAutoRecording(rooms))
      ),
      // cut web-app "refresh items" overlay screen from the recording video
      fromEvent(this.inst.eventBus, SessionEventTypes.REFRESH_SETTINGS).pipe(
        tap(() => {
          this.workerStore.forEach(({worker}) => this.stopWorker(worker.id, true));
        })
      )
    ).pipe(
      takeUntil(this.destroyed$)
    ).subscribe();
  }

  @Socket(ServerConnectionAPI.GET_SSR_STATE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private getWorkerStateEndpoint(@client client: Client, body: { id: Room['id'] }): void {
    if (!('id' in body)) {
      return;
    }

    const worker = this.getWorker(body.id);
    const workerState = worker?.getState() || {status: BoxWorkerStatus.STOP, id: body.id};

    this.inst.server.sendTo(ServerConnectionAPI.GET_SSR_STATE, workerState, client.id);

    if (this.enableRecordingNotification && workerState.status === BoxWorkerStatus.STARTED) {
      // workaround of issue with duplicated messages in client and race condition with WorkerStatusChange and GetState
      this.inst.server.sendTo(ServerConnectionAPI.GET_SSR_NOTIFICATION, workerState, client.id);
    }
  }

  @Socket(ServerConnectionAPI.START_SSR)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private startWorkerEndpoint(@client client: Client, body: { id: Room['id'], title?: string }): void {
    if (!this.isAttendeeAuthorized(client.data.aid)) {
      return;
    }

    if (!('id' in body) || !this.isRecordingAllowedForRoom(body.id)) {
      return;
    }

    const room = this.inst.model.roomsIndex[body.id];
    if (!room || room.isTestRoom) {
      return;
    }

    const payload: SsrWorkerPayload = {
      id: room.id,
      aid: client.data.aid,
      title: body?.title || this.getAutoRecordingVideoName(room.id),
      playlistId: this.getPlaylistIdForRoom(room.id)
    };
    this.startWorker(payload);
  }

  private initiateAutoRecording(rooms: Room[]) {
    rooms.forEach(room => {
      if (this.inst.roomEngine.hasAnyInRoom(room.id)) {
        this.toggleWorkerForRoom(room.id);
      }
    });
  }

  @Socket(ServerConnectionAPI.STOP_SSR)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private stopWorkerEndpoint(@client client: Client, body: { id: Room['id'] }): void {
    if (!this.isAttendeeAuthorized(client.data.aid)) {
      return;
    }

    if (!('id' in body) || !this.isRecordingAllowedForRoom(body.id) || this.isAutoRecordingEnabledForRoom(body.id)) {
      return;
    }

    const room = this.inst.model.roomsIndex[body.id];

    if (!room) {
      // NOTIFY USERS FOR FAILED STOP
      return;
    }

    this.stopWorker(body.id);
  }

  /**
   * @tool Simulate connection drop in both directions
   *
   * @link https://sock.local.interactive.com/meeting/<MID>/refresh-ssr-client[?server=1][&room=<RID>]
   */
  @Get(ServerRestAPI.REFRESH_SSR_CLIENT) // @SUT
  private onRefreshSsrClient(params) {
    if (!config.get('sut.enabled')) {
      return;
    }

    const worker = this.getWorker(params.room || '');

    if (!worker?.hasJob()) {
      return;
    }

    for (const key in this.inst.model.attendeesIndex) {
      const attendee = this.inst.model.attendeesIndex[key];

      if (attendee.staticRole === Roles.RECORDER && attendee.room === worker.id && !attendee.left) {
        for (const [_, client] of this.inst.server.clients) {
          if (params.server) {
            this.inst.server.disconnect(client.id, (params.kill ? ErrorCodes.KILL : 0));
          } else {
            this.inst.server.sendTo(ClientConnectionAPI.REFRESH_CONNECTION, undefined, client.id);
          }
          return;
        }
      }
    }
  }

  private startWorker(payload: SsrWorkerPayload) {
    const worker = this.createWorker(payload);

    if (worker.hasJob()) {
      return;
    }

    worker.start();
  }

  private stopWorker(id: Room['id'], preserveState = false): void {
    // preserve=true is used for pausing worker to keep worker state
    const worker = this.getWorker(id);

    if (worker) {
      let reason = BoxWorkerStatus.PAUSE;
      if (!preserveState) {
        reason = BoxWorkerStatus.STOP;
        this.removePlaylistForRoom(id); // playlist should be preserved only if worker is paused.
      }
      worker.stop(reason);
    }
  }

  private createWorker(payload: SsrWorkerPayload, status?: BoxWorkerStatus): SsrWorker {
    const currentWorker = this.getWorker(payload.id);

    if (currentWorker) {
      return currentWorker;
    }

    const worker = new SsrWorker(payload, this.inst, status || BoxWorkerStatus.STOP);
    this.workerStore.set(payload.id, {
      worker,
      subscriptions: worker.state$.pipe(
        takeUntil(this.destroyed$)
      ).subscribe(state => {
        this.onWorkerStateChange(state);
      })
    });

    return worker;
  }

  private getWorker(id: SsrWorkerPayload['id']): SsrWorker | undefined {
    return this.workerStore.get(id)?.worker;
  }

  private destroyWorker(id: SsrWorkerPayload['id']) {
    // if preserve=true used it only stops worker but stays in store
    // this is used in cases where transcribe was started in room and host/co-host or everyone left
    // transcribe should start again if  started
    const worker = this.getWorker(id);

    if (worker) {
      this.workerStore.get(id).subscriptions.unsubscribe();
      this.workerStore.delete(id);
    }
  }

  private onWorkerStateChange(state:  SsrWorkerState): void {
    if (state.status === BoxWorkerStatus.STOP) {
      this.destroyWorker(state.id);
    }

    this.sendState(state);

    if (state['reason'] === BoxWorkerReason.COMPLETE && this.isAutoRecordingEnabledForRoom(state.id)) {
      const payload: SsrWorkerPayload = {
        id: state.id,
        aid: this.inst.model.sessionSettings.hostID,
        title: this.getAutoRecordingVideoName(state.id),
        playlistId: this.getPlaylistIdForRoom(state.id)
      };

      this.startWorker(payload);
    }
  }

  private sendState(state: SsrWorkerState) {
    this.inst.eventBus.emit(SessionEventTypes.SSR_STATUS, state);
    this.inst.roomEngine.sendToRoom(state.id, ServerConnectionAPI.GET_SSR_STATE, state);
    if (this.enableRecordingNotification) {
      this.inst.roomEngine.sendToRoomWithFallback(state.id, ClientConnectionAPI.GET_SSR_NOTIFICATION, state);
      return;
    }
    this.inst.roomEngine.sendToRoomMainPresentersWithFallback(state.id, ClientConnectionAPI.GET_SSR_NOTIFICATION, state);
  }

  private toggleAllWorkersForAllRooms(isNoPresenterAvailable: boolean): void {
    this.workerStore.forEach(({worker}) => {
      if (isNoPresenterAvailable) {
        if (worker.hasJob()) {
          this.stopWorker(worker.id, true);
          return;
        }
      }

      if (!worker.hasJob() &&
        this.inst.roomEngine.hasAnyInRoom(worker.id)) {
        this.startWorker(worker.payload);
      }
    });
  }

  private toggleWorkerForRoom(roomId: Room['id'], excludeAttendeeId = '') {
    let worker = this.getWorker(roomId);

    if (!worker) {
      if (!this.isRecordingAllowedForRoom(roomId) || !this.isAutoRecordingEnabledForRoom(roomId)) {
        return;
      }

      const payload: SsrWorkerPayload = {
        id: roomId,
        aid: this.inst.model.sessionSettings.hostID,
        title: this.getAutoRecordingVideoName(roomId),
        playlistId: this.getPlaylistIdForRoom(roomId)
      };

      worker = this.createWorker(payload);
    }

    if (worker.hasJob() && !this.inst.roomEngine.hasAnyInRoom(roomId, excludeAttendeeId)) {
      this.stopWorker(roomId, true);
      return;
    }

    if (!worker.hasJob() &&
      this.inst.roomEngine.hasAnyInRoom(roomId, excludeAttendeeId) &&
      this.inst.roomEngine.hasAnyPresenter &&
      !this.inst.model.roomsIndex[roomId].isTestRoom) {
      this.startWorker(worker.payload);
    }
  }

  private getAutoRecordingVideoName(roomId: Room['id']) {
    const room = this.inst.model.roomsIndex[roomId];
    return (room.nameRecording || `${this.inst.model.sessionSettings.name} - ${room.title}`);
  }

  private getPlaylistIdForRoom(roomId: Room['id']) {
    const playlistId = this.playlistsMap.get(roomId);

    if (playlistId) {
      return playlistId;
    }

    const newPlaylistId = v4();
    this.playlistsMap.set(roomId, newPlaylistId);

    return newPlaylistId;
  }

  private removePlaylistForRoom(roomId: Room['id']) {
    const playlistId = this.playlistsMap.get(roomId);

    if (playlistId) {
      this.playlistsMap.delete(roomId);
    }
  }

  private isRecordingAllowedForRoom(roomId: Room['id']) {
    return (!roomId && this.inst.model.sessionSettings.allowRecording ||
            roomId !== '' && this.inst.model.sessionSettings.breakoutRoomRecording);
  }

  private isAutoRecordingEnabledForRoom(id: Room['id']) {
    return this.inst.model.roomsIndex[id].autoRecording;
  }

  private isAttendeeAuthorized(aid: Attendee['id']): boolean {
    const attendee = this.inst.model.attendeesIndex[aid];
    return this.inst.roomEngine.isHost(attendee) || this.inst.roomEngine.isCoHost(attendee);
  }
}
