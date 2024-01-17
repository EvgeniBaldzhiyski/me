import BaseModule from '../../BaseModule';
import { Get, Socket } from '../../../../../gateway/decorators/method.decorator';
import { Attendee, BoxWorkerState, BoxWorkerStatus, ClientConnectionAPI, ErrorCodes, Roles, Room, ServerConnectionAPI } from '@container/models';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import Client from '../../../../../utils/Client';
import { BoxWorker } from '../utils/workers/box.worker';
import { client } from '../../../../../gateway/decorators/argument.decorator';
import { fromEvent, merge, Subscription } from 'rxjs';
import { takeUntil, tap } from 'rxjs/operators';
import { SessionEventTypes } from '../../../events/SessionEvents';
import { DB_COLLECTIONS, defaultDb } from '../../../../../database';
import { BoxWorkerBasePayload, BoxWorkerMongodbSchema } from '../utils/workers/box.worker.interface';
import { TranscribeWorker } from './transcribe.worker';
import Meeting from '../../../Meeting';
import config from 'config';

export default class TranscribeModule extends BaseModule {
  protected stateCollection = defaultDb().collection(DB_COLLECTIONS.TRANSCRIBE_MODULE_STATE);
  private workerStore: Map<Room['id'], { worker: TranscribeWorker, subscriptions: Subscription }> = new Map();

  static isEnabled(inst: Meeting) {
    return inst.model.sessionSettings.speechToTextEnabled;
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
  protected populateState({workers}: BoxWorkerMongodbSchema): void {
    for (const payload of workers) {
      this.createWorker(payload, BoxWorkerStatus.PAUSE);
    }
  }

  @ApmSpan()
  protected serializeState(): BoxWorkerMongodbSchema | null {
    const workers: BoxWorkerBasePayload[] = [];

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
      )
    ).pipe(
      takeUntil(this.destroyed$)
    ).subscribe();
  }

  @Socket(ServerConnectionAPI.GET_TRANSCRIBE_STATE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private getWorkerStateEndpoint(@client client: Client, body: { id: Room['id'] }): void {
    if (!('id' in body)) {
      return;
    }

    const worker = this.getWorker(body.id);
    const workerState = worker?.getState() || {status: BoxWorkerStatus.STOP, id: body.id};

    this.inst.server.sendTo(ServerConnectionAPI.GET_TRANSCRIBE_STATE, workerState, client.id);
  }

  @Socket(ServerConnectionAPI.START_TRANSCRIBE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private startWorkerEndpoint(@client client: Client, body: { id: Room['id'] }): void {
    if (!this.isAttendeeAuthorized(client.data.aid)) {
      return;
    }

    if (!('id' in body)) {
      return;
    }

    const room = this.inst.model.roomsIndex[body.id];

    if (!room || room.isTestRoom) {
      return;
    }
    this.startWorker({id: body.id});
  }

  @Socket(ServerConnectionAPI.STOP_TRANSCRIBE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private stopWorkerEndpoint(@client client: Client, body: { id: Room['id'] }): void {
    if (!this.isAttendeeAuthorized(client.data.aid)) {
      return;
    }

    if (!('id' in body)) {
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
  @Get('refresh-transcribe-client') // @SUT
  private onRefreshSsrClient(params) {
    if (!config.get('sut.enabled')) {
      return;
    }

    const worker = this.getWorker(params.room || '');

    if (!worker?.hasJob()) {
      return;
    }

    const ghosts = this.inst.attendeeStorage.getAttendeesByRole(Roles.GHOST);

    for (const [_, ghost] of ghosts) {
      if (ghost.staticRole === Roles.TRANSCRIBE && ghost.room === worker.id && !ghost.left) {
        for (const [_, client] of this.inst.server.clients) {
          if (client.data.aid === ghost.id) {
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
  }

  private startWorker(payload: BoxWorkerBasePayload) {
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
      const reason = preserveState ? BoxWorkerStatus.PAUSE : BoxWorkerStatus.STOP;
      worker.stop(reason);
    }
  }

  private createWorker(payload: BoxWorkerBasePayload, status?: BoxWorkerStatus): BoxWorker {
    const currentWorker = this.getWorker(payload.id);

    if (currentWorker) {
      return currentWorker;
    }

    const worker = new TranscribeWorker(payload, this.inst, status);
    this.workerStore.set(payload.id, {
      worker,
      subscriptions: worker.state$.pipe(
        takeUntil(this.destroyed$)
      ).subscribe(state => {
        this.onWorkerStateChange(state);

        if (state.status === BoxWorkerStatus.STOP) {
          this.destroyWorker(payload.id);
        }
      })
    });

    return worker;
  }

  private getWorker(id: BoxWorkerBasePayload['id']): BoxWorker | undefined {
    return this.workerStore.get(id)?.worker;
  }

  private destroyWorker(id: BoxWorkerBasePayload['id']) {
    // if preserve=true used it only stops worker but stays in store
    // this is used in cases where transcribe was started in room and host/co-host or everyone left
    // transcribe should start again if  started
    const worker = this.getWorker(id);

    if (worker) {
      this.workerStore.get(id).subscriptions.unsubscribe();
      this.workerStore.delete(id);
    }
  }

  private onWorkerStateChange(state:  BoxWorkerState): void {
    this.inst.roomEngine.sendToRoomWithFallback(state.id, ClientConnectionAPI.GET_TRANSCRIBE_STATE, state);
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
        worker.isPaused() &&
        this.inst.roomEngine.hasAnyInRoom(worker.id)) {
        this.startWorker(worker.payload);
      }
    });
  }

  private toggleWorkerForRoom(roomId: Room['id'], excludeAttendeeId = '') {
    const worker = this.getWorker(roomId);

    if (!worker) {
      return;
    }

    if (worker.hasJob() && !this.inst.roomEngine.hasAnyInRoom(roomId, excludeAttendeeId)) {
      this.stopWorker(roomId, true);
      return;
    }

    if (!worker.hasJob() &&
      worker.isPaused() &&
      this.inst.roomEngine.hasAnyInRoom(roomId, excludeAttendeeId) &&
      this.inst.roomEngine.hasAnyPresenter
    ) {
      this.startWorker(worker.payload);
    }
  }

  private isAttendeeAuthorized(aid: Attendee['id']): boolean {
    const attendee = this.inst.model.attendeesIndex[aid];
    return this.inst.roomEngine.isHost(attendee) || this.inst.roomEngine.isCoHost(attendee);
  }
}
