import {
  BoxWorkerEvent,
  BoxWorkerInitializing,
  BoxWorkerPaused,
  BoxWorkerReason,
  BoxWorkerRetry,
  BoxWorkerStarted,
  BoxWorkerState,
  BoxWorkerStatus,
  BoxWorkerStopped
} from '@container/models';
import Meeting from '../../../../Meeting';
import { BehaviorSubject, concat, defer, EMPTY, from, iif, Observable, of, race, Subject, Subscription, throwError, timer } from 'rxjs';
import {
  catchError,
  filter,
  finalize,
  map,
  mapTo, repeat,
  shareReplay,
  skip,
  switchMap,
  switchMapTo, take,
  takeUntil,
  tap,
  toArray
} from 'rxjs/operators';
import { BoxWorkerController, BoxWorkerStartTaskQueuePac } from './box.worker.controller';
import { workerFactoryCreator } from '../../../../../../tasks/worker-factory';
import { retryBackoff } from 'backoff-rxjs';
import { TaskStatus } from '../../../../../../tasks/task-resources';
import { getGhostUserAuth } from '../../../../../../utils/get-ghost-user-auth';
import apm from 'elastic-apm-node/start';
import { RemoteWorkerFactory } from '@container/task-queue';
import { BoxWorkerBasePayload } from './box.worker.interface';
import { TokenSet } from 'openid-client';
import config from 'config';

export abstract class BoxWorker<T extends BoxWorkerBasePayload = BoxWorkerBasePayload, K extends BoxWorkerState = BoxWorkerState> {
  private events = new Subject<BoxWorkerEvent>();
  events$ = this.events.asObservable();

  private state: BehaviorSubject<K>;
  state$: Observable<K>;

  private worker: BoxWorkerController;

  public readonly id: T['id'];

  protected maxStartingAttempts = 4; // configurable from super class
  protected startTimeout = 30000; // configurable from super class

  protected maxRabbitmqInitFailedAttempts = 5; // configurable from super class
  protected rabbitmqRetryInterval = 15000; // configurable from super class

  protected maxTokenGenerationFailedAttempts = 5; // configurable from super class
  protected tokenGenerationRetryInterval = 15000; // configurable from super class

  protected maxWorkerFailedAttempts = 5; // configurable from super class

  private startingAttempts = 0;
  private failedWorkerAttempts = 0;

  private workerEventsSubscription: Subscription;

  constructor(public readonly payload: T,
              protected inst: Meeting,
              protected readonly status?: BoxWorkerStatus) {
    this.id = this.payload.id;
    this.setup();
  }

  protected setup(state?: Partial<K>) {
    const initialState = {
      id: this.payload.id,
      status: this.status || BoxWorkerStatus.STOP,
      ...state
    } as K;

    this.state = new BehaviorSubject<K>(initialState);
    this.state$ = this.state.asObservable().pipe(skip(1), shareReplay(1));
  }
  private mutateStateFromEvent(event: BoxWorkerEvent) {
    this.state.next({...this.getState(), ...event});
  }

  getState(): K {
    return this.state.getValue();
  }

  getCurrentStatus() {
    return this.getState().status;
  }

  start(): void {
    this.bindWorkerEvents();
    this.triggerEvent(new BoxWorkerInitializing());
  }

  stop(reason: BoxWorkerStatus.STOP | BoxWorkerStatus.PAUSE = BoxWorkerStatus.STOP): void {
    const event = reason === BoxWorkerStatus.PAUSE ? new BoxWorkerPaused() : new BoxWorkerStopped();
    this.triggerEvent(event);
  }

  hasJob(): boolean {
    return !([BoxWorkerStatus.PAUSE, BoxWorkerStatus.STOP].includes(this.getCurrentStatus()));
  }

  isPaused(): boolean {
    return this.getCurrentStatus() === BoxWorkerStatus.PAUSE;
  }

  private triggerEvent(event: BoxWorkerEvent): void {
    this.mutateStateFromEvent(event);
    this.events.next(event);
  }

  private createAndStartWorker(workerFactory: RemoteWorkerFactory, meetingUrl: string) {
    this.worker = new BoxWorkerController(
      workerFactory,
      (this.inst.model.meetingID + this.payload.id),
      this.createTaskQueueStartPack(meetingUrl),
      this.inst.logger,
      this.constructor.name
    );

    this.worker.start();

    return this.worker;
  }

  private destroyWorker(): void {
    this.worker?.stop();
    this.worker = undefined;
  }

  private bindWorkerEvents() {
    this.workerEventsSubscription?.unsubscribe();
    this.workerEventsSubscription = this.events$.pipe(
      filter(e => [BoxWorkerInitializing, BoxWorkerRetry].some((type) => e instanceof type)),
      tap(() => (this.destroyWorker())),
      switchMap(() =>
        iif(
          () => this.shouldCreateRetry() && this.shouldWorkerFailedRetry(),
          race(
            timer(this.startTimeout).pipe(
              take(1),
              tap(() => this.startingAttempts++),
              map(() => new BoxWorkerRetry())
            ),
            concat(
              this.createWorkerRabbitMQConnection().pipe(
                retryBackoff({
                  maxRetries: this.maxRabbitmqInitFailedAttempts,
                  initialInterval: this.rabbitmqRetryInterval,
                  resetOnSuccess: true,
                }),
              ),
              this.generateMeetingUrlForRoom().pipe(
                retryBackoff({
                  maxRetries: this.maxTokenGenerationFailedAttempts,
                  initialInterval: this.tokenGenerationRetryInterval,
                  resetOnSuccess: true
                })
              )
            ).pipe(
              toArray(),
              switchMap(([workerFactory, meetingUrl]: [RemoteWorkerFactory, string]) => {
                return defer(() =>
                  of(this.createAndStartWorker(workerFactory, meetingUrl)).pipe(
                    switchMap(worker => this.handleWorkerEventsObservable(worker))
                  )
                );
              }),
            ),
          ),
          defer(() =>
            throwError(`${this.constructor.name} for RoomID: ${this.id} failed to respond withing start attempts ${this.startingAttempts} or reached max error attempts ${this.failedWorkerAttempts}`)
          )
        )
      ),
      catchError(() => {
        return of(new BoxWorkerStopped(BoxWorkerReason.ERROR));
      }),
      takeUntil(
        this.events$.pipe(filter(e => [BoxWorkerPaused, BoxWorkerStopped].some((type) => e instanceof type)))
      ),
      finalize(() => {
        this.destroyWorker();
      }),
      tap((e) => {
        this.triggerEvent(e);
      })
    ).subscribe();
  }

  private shouldWorkerFailedRetry(): boolean {
    return this.failedWorkerAttempts <= this.maxWorkerFailedAttempts;
  }

  private shouldCreateRetry(): boolean {
    return this.startingAttempts < this.maxStartingAttempts;
  }

  private handleWorkerEventsObservable(worker: BoxWorkerController): Observable<BoxWorkerEvent> {
    return worker.observer$.pipe(
      map(({status}) => {
        if (status === TaskStatus.WORKING) {
          this.startingAttempts = 0;
          return new BoxWorkerStarted();
        }

        if (status === TaskStatus.DONE) {
          this.failedWorkerAttempts = 0;
          this.startingAttempts = 0;
          return new BoxWorkerStopped(BoxWorkerReason.COMPLETE);
        }

        if (status === TaskStatus.FAILED) {
          this.failedWorkerAttempts++;
          return new BoxWorkerRetry();
        }
      })
    );
  }

  protected createTaskQueueStartPack(url: string): BoxWorkerStartTaskQueuePac {
    return {
      cid: this.inst.model.sessionSettings.companyId,
      mid: this.inst.model.meetingID,
      mrunid: this.inst.model.meetingRunID,
      url,
      rid: this.id,
      meetingName: this.inst.model.sessionSettings.name
    };
  }

  protected getRabbitMQConnectionFactory() {
    return workerFactoryCreator(
      {
        exchangeName: 'task-exchange',
        queueName: 'base-worker-queue',
        routingKey: 'base-worker'
      },
      'BASE_WORKER'
    );
  }

  private createWorkerRabbitMQConnection() {
    return defer(() => from(this.getRabbitMQConnectionFactory().start()).pipe(
      mapTo(this.getRabbitMQConnectionFactory()),
      catchError(err => {
        apm.captureError(err);
        return throwError(new Error(`RabbitMQ Connection failed when trying to init worker ${this.constructor.name} for RoomId: ${this.id}. Stack: ${err}`));
      })
    ));
  }

  protected getUrlParams(token: TokenSet['access_token']) {
    return {
      mid: this.inst.model.meetingID,
      aid: this.inst.model.sessionSettings.hostID,
      rid: this.id,
      mode: 'base-box',
      id_token: token,
      debug: '1'
    };
  }

  private generateMeetingUrlForRoom() {
    return defer(() => from(getGhostUserAuth()).pipe(
      map(({access_token}) => {
        return Object.assign(
          new URL('/Conference/', config.get('appUrl')),
          {hash: new URLSearchParams(this.getUrlParams(access_token)).toString()}
        ).toString();
      }),
      catchError(err => {
        apm.captureError(err);
        return throwError(new Error(`Failed generating Authentication token for $${this.constructor.name} with RoomID: ${this.id}. Stack: ${err}`));
      })
    ));
  }
}
