import apm, { Transaction } from 'elastic-apm-node/start';
import config from 'config';
import { Task, Worker, WorkerFactory } from '@jigsawinteractive/task-queue';
import {
  catchError,
  combineLatest,
  finalize,
  from,
  ignoreElements,
  lastValueFrom,
  mapTo,
  merge,
  Observable,
  of,
  race,
  Subject,
  switchMap,
  takeUntil,
  tap,
  throwError
} from 'rxjs';
import logger from '../../core/logger';
import { generateMediaStream } from '../../core/stream-generator/stream-generator';
import { joinInMediaRoom } from '../../communication/media.gateway';
import { TranscribeProvider } from './providers/transcribe-provider.interface';
import { AmazonTranscribeProvider } from './providers/amazon-transcribe.provider';
import { transcribeSessionHistogram } from './utils/metrics';
import { runningSessionsGauge } from '../../utils/metrics';
import { Payload } from '../utils/payload';
import { kafkaProducer } from '../../utils/kafka-producer';
import {
  StartTranscribePayload,
  StopTranscribePayload,
  TranscribeActionMessage,
  TranscribeState
} from '../../utils/fa-event-types';
import { getMediaStreamLogChinks } from '../../core/tab-monitoring/tab-monitoring';

export class TranscribeWorkerError extends Error {
  constructor(
    message: string,
    public reason: string
  ) {
    super(message);
  }
}

export class TranscribeWorker implements Worker {
  private transaction?: Transaction;
  private stopped$ = new Subject<true>();
  private transcribeProvider: TranscribeProvider = new AmazonTranscribeProvider();
  private startTime: number;

  constructor(
    readonly id: string,
    readonly payload: Payload
  ) {
    logger.debug(`INITIALIZING: (${this.id}) ${JSON.stringify(this.payload)}`);
  }

  run(accept: (data?: Payload) => Promise<void>, ready?: () => Promise<void>): Promise<unknown> {
    const roomId = `${this.payload.mid}${this.payload.rid !== '' ? `_${  this.payload.rid}` : ''}`;

    apm.setCustomContext({
      id: this.id,
      roomId
    });

    logger.referenceId = `${this.payload.mid}.${this.payload.mrunid}.${this.id}`;
    logger.traceId = apm.currentTraceIds['trace.id'];

    this.transaction = apm.startTransaction('Transcribe Task');
    logger.transactionId = this.transaction.ids['transaction.id'];

    const runSpan = this.transaction?.startSpan('run');
    logger.transactionId = this.transaction.ids['transaction.id'];

    logger.debug('RUN TRANSCRIBE WORKER');

    return lastValueFrom(
      race(
        this.stopped$.pipe(mapTo(true)),
        from(ready()) // to be sure the task is already not declined
      ).pipe(
        switchMap(immediateStop => {
          if (immediateStop) {
            return of(null);
          }
          return merge(
            this.initializeMetrics().pipe(ignoreElements()),
            generateMediaStream(this.payload.url)
          ).pipe(
            switchMap(mediaStream => combineLatest([
              joinInMediaRoom(
                roomId,
                `${config.get('service.name')}_${this.payload.rid}`,
                `${config.get('service.name')}_${this.payload.rid}`
              ).pipe(
                switchMap(factory => factory.producerFactory.createData({ label: config.get('service.name') }).produce())
              ),
              this.transcribeProvider.connect(mediaStream)
            ]).pipe(
              tap(() => {
                logger.debug('TASK IS ACCEPTED');
                void accept(this.payload);

                this.startTime = Date.now();
                kafkaProducer.sendSync(this.payload.mid, new TranscribeActionMessage(
                  TranscribeState.Start,
                  this.id,
                  new StartTranscribePayload(
                    this.payload.cid,
                    this.payload.mid,
                    this.payload.rid,
                    this.payload.mrunid,
                    this.startTime)
                ));
              }),
              switchMap(([dataStream, transcribeStream]) => this.transcribeProvider.transcribe(transcribeStream).pipe(
                tap(transcript => {
                  dataStream.next(JSON.stringify(transcript));
                }),
              )),
              finalize(() => {
                // TODO: this "if" is weird, so a change in
                // the transcribe start detection should be considered
                // While we are joining media room and connect to the transcribe service
                // We recieve STOP and this the start is not send,
                // so the this.start time is undefined
                // ---
                // A wise man once said do not stop what you have not started
                if (!this.startTime) {
                  return;
                }

                const endTime = new Date().getTime();
                kafkaProducer.sendSync(this.payload.mid, new TranscribeActionMessage(
                  TranscribeState.Stop,
                  this.id,
                  new StopTranscribePayload(
                    this.payload.cid,
                    this.payload.mid,
                    this.payload.rid,
                    this.payload.mrunid,
                    Math.abs((endTime - this.startTime) / 1000),
                    endTime)
                ));
              })
            )),
          );
        }),
        catchError(err => {
          const message = err.message || err.Message;

          err.message = `THE CHAIN IS BROKEN. REASON: ${message}`;

          logger.error(err, {...this.payload, ...getMediaStreamLogChinks()});

          return throwError(() => err as Error);
        }),
        takeUntil(this.stopped$),
        finalize(() => {
          logger.debug('WORKER IS CLEANED');
          runSpan?.end();
        }),
      )
    );
  }

  onMessage(message?: { command: string }): Promise<void> {
    if (message?.command === 'stop') {
      logger.debug('RECEIVE COMMAND STOP');
      this.stopped$.next(true);
    }
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    logger.debug('SHUTDOWN...');

    this.stopped$.next(true);
    // TODO: Figure out how to get and pass a `result = 'success' | 'error'`
    this.transaction?.end();
    this.transaction = undefined;

    logger.referenceId = '';
    logger.traceId = '';
    logger.transactionId = '';
    logger.removeSpanId();

    return Promise.resolve();
  }

  private initializeMetrics() {
    return new Observable<true>(observable => {
      const labels = {
        cid: this.payload.cid,
        mid: this.payload.mid,
        rid: this.payload.rid === '' ? 'Main Room' : this.payload.rid,
        meetingName: this.payload.meetingName
      };
      runningSessionsGauge.inc(labels);
      // TODO: There could be problems in case one box handles too many tasks,
      //       the metrics will become huge and we won't be able to collect them,
      //       resulting in Prometheus overloads as well
      const timer = transcribeSessionHistogram.startTimer({
        cid: this.payload.cid,
        mid: this.payload.mid,
        rid: this.payload.rid === '' ? 'Main Room' : this.payload.rid,
        meetingName: this.payload.meetingName
      });
      observable.next(true);
      return () => {
        runningSessionsGauge.remove(labels);
        timer();
      };
    });
  }
}

export class TranscribeWorkerFactory implements WorkerFactory {
  create(job: Task): Promise<Worker> {
    return Promise.resolve(new TranscribeWorker(job.id, job.payload));
  }
}
