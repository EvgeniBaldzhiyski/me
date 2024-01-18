import apm, { Transaction } from 'elastic-apm-node/start';
import config from 'config';
import { Task, Worker, WorkerFactory } from '@jigsawinteractive/task-queue';
import {
  catchError, EMPTY, finalize, from, ignoreElements, lastValueFrom, map, mapTo, merge, Observable, of, race,
  Subject, switchMap, takeUntil, tap, throwError
} from 'rxjs';
import logger from '../../core/logger';
import { generateMediaStream } from '../../core/stream-generator/stream-generator';
import { joinInMediaRoom } from '../../communication/media.gateway';
import { runningSessionsGauge } from '../../utils/metrics';
import { Payload } from '../utils/payload';
import { ProducerSource } from '@jigsawinteractive/mediasoup-client';
import { TwilioVoiceProvider } from './providers/twilio-voice.provider';
import { getMediaStreamLogChinks } from '../../core/tab-monitoring/tab-monitoring';

export class VoiceWorkerError extends Error {
  constructor(
    message: string,
    public reason: string
  ) {
    super(message);
  }
}

export class VoiceWorker implements Worker {
  private transaction?: Transaction;
  private stopTask$ = new Subject<true>();

  private voiceProvider: TwilioVoiceProvider = new TwilioVoiceProvider();

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

    logger.debug('RUN WORKER');

    return lastValueFrom(
      race(
        this.stopTask$.pipe(mapTo(true)),
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
            switchMap(mediaStream => {
              logger.debug(`JOIN IN ROOM ${roomId}, ${config.get('service.name')}, ${config.get('service.name')}`);

              return joinInMediaRoom(roomId, config.get('service.name'), config.get('service.name')).pipe(
                switchMap(factory => {
                  logger.debug('CREATE PRODUCER');
                  return of(factory.producerFactory.create('audio', ProducerSource.mic));
                }),
                switchMap(producer => this.voiceProvider.exchange(this.payload.mid, roomId, mediaStream).pipe(
                  map(voiceStream => {
                    logger.debug('EXTRACT VOICE TRACK');
                    const track = voiceStream.getAudioTracks()[0];

                    if (!track || track.muted) {
                      throw new Error(`Voice track is invalid ${track?.muted}`);
                    }

                    return track;
                  }),
                  // @todo check the ability to retry to exchange in case something in provider fails
                  switchMap(voiceTrack => {
                    logger.debug('PRODUCE VOICE TRACK');
                    return producer.produce(voiceTrack);
                  })
                ))
              ).pipe(
                tap(() => {
                  logger.debug('TASK IS ACCEPTED');
                  void accept(this.payload);
                }),
              );
            }),
          );
        }),
        catchError(err => {
          const message = err.message || err.Message;

          err.message = `THE CHAIN IS BROKEN. REASON: ${message}`;

          logger.error(err, {...this.payload, ...getMediaStreamLogChinks()});

          return throwError(() => err as Error);
          return EMPTY;
        }),
        takeUntil(this.stopTask$),
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
      this.stopTask$.next(true);
    }
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    logger.debug('SHUTDOWN...');

    this.stopTask$.next(true);
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
      observable.next(true);
      return () => {
        runningSessionsGauge.remove(labels);
      };
    });
  }
}

export class VoiceWorkerFactory implements WorkerFactory {
  create(job: Task): Promise<Worker> {
    return Promise.resolve(new VoiceWorker(job.id, job.payload));
  }
}
