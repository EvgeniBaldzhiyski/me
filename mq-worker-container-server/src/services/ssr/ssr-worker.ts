/* eslint-disable no-unused-expressions */
import apm, { Transaction } from 'elastic-apm-node/start';
import { Task, Worker, WorkerFactory } from '@jigsawinteractive/task-queue';
import {
  catchError, of, ignoreElements, finalize, from, tap, throwError, race,
  timer, lastValueFrom, switchMap, take, takeUntil, merge, fromEvent,
  delay, mapTo, firstValueFrom, filter, BehaviorSubject, Observable, NEVER, withLatestFrom, skip, map, shareReplay
} from 'rxjs';
import logger from '../../core/logger';
import { mediaRecorder } from './utils/media-recorder';
import config from 'config';
import { v4 } from 'uuid';
import { getVideoMetadata, videoGenerator, VideoMetadata } from './utils/video-generator';
import { SsrPayload } from './utils/ssr-payload';
import { videoUploader } from './utils/video-uploader';
import { sendVideoInformation } from './utils/core-api.gateway';
import { FileExistValidator, MinDurationValidator, validateFileExists, validateMinDuration } from './utils/video-validators';
import { runningSessionsGauge } from '../../utils/metrics';
import { unlink } from 'fs/promises';
import { generateMediaStream } from '../../core/stream-generator/stream-generator';
import ContextError from '../../utils/context-error';

export class SsrWorkerError extends Error {
  constructor(message: string, public reason: string) {
    super(message);
  }
}

export enum SSRWorkerStatus {
  IDLE,
  IN_PROGRESS,
  DONE
}

export enum SSRStopCommands {
  MAX_LENGTH = 'MAX_LENGTH',
  SHUTDOWN = 'SHUTDOWN',
  RECEIVE_CMD = 'RECEIVE_CMD',
  FAILED = 'FAILED'
}

// Match SSR v1 options found in conference/chrome-box/config/default.yml videoSettings
// NOTE: Typings are not well implemented
const videoConstraints = {
  mandatory: {
    minWidth: 1920,
    minHeight: 1080,
    maxWidth: 1920,
    maxHeight: 1080,
    maxFrameRate: 15
  }
} as chrome.tabCapture.CaptureOptions['videoConstraints'];

let _taskExecutionCounter = 0;
const _maxExecutedTasks = parseInt(config.get('ssr.maxExecutedTasks'), 10);

function taskExecutionCounter() {
  _taskExecutionCounter++;

  if (_taskExecutionCounter >= _maxExecutedTasks) {
    // NOTE: This is a workaround for
    //    JIG-10640 [SSR v2] Memory leak with MediaRecorder could cause OOM Killer to force kill the POD crashing the SSR
    //    feel free to remove it once the memory leak is covered
    logger.warn('MAX JOBS IS REACHED. THE LATEST TASK IS IN PROGRESS...');

    process.emit('SIGTERM', 'SIGTERM');
  }
}

export class SsrWorker implements Worker {
  private transaction?: Transaction;
  private jobStop = new BehaviorSubject<{command: SSRStopCommands; error?: Error}>(undefined);
  private jobStop$: Observable<{command: SSRStopCommands; error?: Error}>;
  private filePath = `${config.get('ssr.resourceStorage')}/${v4()}.${config.get('ssr.mimeType')}`;
  private workerStatus$ = new BehaviorSubject<SSRWorkerStatus>(SSRWorkerStatus.IDLE);

  private delayTimeBetweenStages = 1000;
  private durationTimer = {startTime: null, endTime: null};

  private get workerStatus(): SSRWorkerStatus {
    return this.workerStatus$.getValue();
  }

  constructor(
    readonly id: string,
    readonly payload: SsrPayload
  ) {
    this.jobStop$ = this.jobStop.asObservable().pipe(skip(1), shareReplay(1));

    logger.debug(`INITIALIZING: (${this.id}) ${JSON.stringify(this.payload)}`);
  }

  run(accept: (data?: SsrPayload) => Promise<void>, ready?: () => Promise<void>): Promise<unknown> {
    logger.referenceId = `${this.payload.mid}.${this.payload.mrunid}.${this.id}`;
    logger.traceId = apm.currentTraceIds['trace.id'];

    this.transaction = apm.startTransaction('SSR Task');
    apm.setCustomContext({
      ...this.payload,
      id: this.id
    });

    logger.transactionId = this.transaction.ids['transaction.id'];

    const runSpan = this.transaction?.startSpan('run');
    runSpan && logger.setSpanId(runSpan.ids['span.id']);

    logger.debug('RUN SSR WORKER');

    taskExecutionCounter();

    return lastValueFrom(
      race(
        this.jobStop$.pipe(mapTo(true)),
        from(ready()) // to be sure the task is already not declined
      ).pipe(
        switchMap(immediateStop => {
          logger.debug('PREPARE FOR VIDEO GEN');

          // received stop before trying to init
          if (immediateStop) {
            return of(null);
          }

          // run the process and wait stop command
          return merge(
            this.initializeMetrics().pipe(ignoreElements()),
            generateMediaStream(this.payload.url, {
              audio: true,
              video: true,
              videoConstraints,
            }).pipe(
              catchError((err: ContextError) => {
                if (this.workerStatus === SSRWorkerStatus.IN_PROGRESS) {
                  logger.error(`Stream generator failed during task is in progress: ${err.message}`);
                  this.triggerStop(SSRStopCommands.FAILED, err);
                  return NEVER;
                }

                logger.error(`Stream generator failed before task accept: ${err.message}`);
                return throwError(() => err);
              })
            )
          ).pipe(
            delay(this.delayTimeBetweenStages),
            switchMap(mediaStream => videoGenerator(this.filePath).pipe(
              switchMap(ffmpeg => {
                logger.debug('PREPARE FOR RECORDER');
                const span = this.transaction?.startSpan('Media Recorder');
                span && logger.setSpanId(span.ids['span.id']);

                return mediaRecorder(mediaStream).pipe(
                  tap(() => {
                    logger.debug('TASK IS ACCEPTED');
                    this.workerStatus$.next(SSRWorkerStatus.IN_PROGRESS);
                    void accept(this.payload);
                    this.startDurationTimer();
                  }),
                  switchMap(recStream => {
                    logger.debug('RUN REC STREAM');

                    return merge(
                      from(recStream).pipe(
                        tap(chunk => ffmpeg.stdin.write(chunk)),
                        ignoreElements(),
                      ),
                      of(ffmpeg),
                    );
                  }),
                  finalize(() => {
                    span?.end();
                  })
                );
              }),
            )),
            takeUntil(this.jobStop$)
          );
        }),
        switchMap(ffmpeg => {
          // if the process is declined during initialization
          if (!ffmpeg) {
            logger.debug('REC PROCESS IS DECLINED BEFORE INIT COMPLETION');
            return of(null);
          }

          logger.debug('REC PROCESS IN PROGRESS');
          // wait a ffmpeg stop or a timeout exec and upload video
          return merge(
            fromEvent(ffmpeg, 'close').pipe(
              tap(code => {
                logger.debug(`FFMPEG CLOSED WITH CODE (${code})`);
              }),
            ),
            this.jobStop$.pipe(
              switchMap(() => timer(config.get<number>('ssr.ffmpegTimeout') * 1000).pipe(
                tap(() => {
                  logger.debug('FFMPEG EXIT TIMEOUT');

                  ffmpeg.kill('SIGKILL');
                }),
                take(1),
                ignoreElements()
              ))
            ),
            timer(config.get('ssr.maxLength') * 60 * 1000).pipe(
              tap(() => {
                // manually complete job after X time. (max worker time / max video length)
                this.triggerStop(SSRStopCommands.MAX_LENGTH);
              }),
              take(1),
              ignoreElements()
            ),
          );
        }),
        withLatestFrom(this.jobStop$),
        map(([, jobStop]) => {
          if (jobStop.command === SSRStopCommands.FAILED) {
            throw jobStop.error;
          }

          logger.debug(`STOPPED WORK FROM COMMAND ${jobStop.command}`);
          return jobStop.command;
        }),
        take(1),
        catchError(err => {
          const message = err.message || err.Message;
          err.message = `THE CHAIN IS BROKEN. REASON: ${message}`;

          logger.error(err, {...this.payload});

          return throwError(() => new SsrWorkerError(err.message, message));
        }),
        finalize(() => {
          this.stopDurationTimer();
          runSpan?.end();
          this.workerStatus$.next(SSRWorkerStatus.DONE);

          logger.debug('RECORDING FINALIZE');
        })
      )
    );
  }

  onMessage(message?: { command: string }): Promise<void> {
    if (message?.command === 'stop') {
      this.transaction?.startSpan('stop');
      logger.debug('RECEIVE COMMAND STOP');
      this.triggerStop(SSRStopCommands.RECEIVE_CMD);
    }
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    logger.log('SHUTDOWN TRIGGER...');

    if (this.workerStatus === SSRWorkerStatus.IDLE) {
      return Promise.resolve();
    }

    const shutdownSpan = this.transaction?.startSpan('shutdown');
    shutdownSpan && logger.setSpanId(shutdownSpan.ids['span.id']);

    return firstValueFrom<void>(
      this.workerStatus$.pipe(
        tap((status) => {
          if (status !== SSRWorkerStatus.DONE) {
            this.triggerStop(SSRStopCommands.SHUTDOWN);
          }
        }),
        filter((status) => status === SSRWorkerStatus.DONE),
        switchMap(() =>
          // checking if file exists. Run could be failed so no work should be executed
          validateFileExists(this.filePath).pipe(
            switchMap(() =>
              getVideoMetadata(this.filePath).pipe(
                catchError(() => of({
                  format: {
                    duration: this.getDuration(),
                    tags: {BIRTHTIME: this.durationTimer.startTime}
                  }} as VideoMetadata
                )),
                validateMinDuration(),
                switchMap(metadata => {
                  logger.debug('CHECK VIDEO STATS AND TRY TO UPLOAD');

                  const videoUploaderSpan = this.transaction?.startSpan('Video Uploader');
                  videoUploaderSpan && logger.setSpanId(videoUploaderSpan.ids['span.id']);

                  return videoUploader(this.filePath, this.payload).pipe(
                    switchMap(uploaderResponse =>
                      sendVideoInformation(uploaderResponse.key, this.payload, {
                        size: Math.ceil(metadata.format.size / 1024),
                        duration: parseInt(metadata.format.duration.toString(), 10),
                        birthtimeMs: Math.round(metadata.format.tags.BIRTHTIME / 1000)
                      })
                    ),
                    finalize(() => {
                      videoUploaderSpan?.end();
                    }),
                  );
                }),
                switchMap(() => {
                  logger.debug('CLEARING RESOURCES');
                  return from(unlink(this.filePath));
                }),
                catchError((err: Error) => {
                  logger.debug('CLEARING RESOURCES IN CASE OF ERROR', err);
                  return from(unlink(this.filePath)).pipe(
                    tap(() => {
                      throw err;
                    })
                  );
                }),
              )
            ),
            catchError((err: Error) => {
              // escaping validation errors. They're false positives
              if ([MinDurationValidator, FileExistValidator].some(validatorError => err instanceof validatorError)) {
                logger.debug(`FALSE POSITIVE ERROR IN UPLOAD CHAIN. ${err.message}`);
                return of(null);
              }

              err.message = `ERROR IN UPLOAD CHAIN (${err.message})`;
              const context = {
                ...this.payload,
                context: 'upload error'
              };

              logger.error(err, context);

              return throwError(() => err);
            }),
            finalize(() => {
              logger.log('SHUTDOWN COMPLETE');

              shutdownSpan?.end();
              // TODO: Figure out how to get and pass a `result = 'success' | 'error'`
              this.transaction?.end();
              this.transaction = undefined;

              logger.referenceId = '';
              logger.traceId = '';
              logger.transactionId = '';
              logger.removeSpanId();
              this.resetDurationTimer();
            }),
            mapTo(void 0)
          )
        )
      )
    );
  }

  private triggerStop(command: SSRStopCommands, error?: Error) {
    this.jobStop.next({command, error});
    logger.debug(`TRIGGER JOB STOP (${command})`);
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

  private startDurationTimer() {
    this.durationTimer.startTime = Date.now();
  }

  private stopDurationTimer() {
    this.durationTimer.endTime = Date.now();
  }

  private resetDurationTimer() {
    this.durationTimer = {
      startTime: null,
      endTime: null
    };
  }

  private getDuration() {
    return (this.durationTimer.endTime - this.durationTimer.startTime) / 1000;
  }
}

export class SsrWorkerFactory implements WorkerFactory {
  create(job: Task): Promise<Worker> {
    return Promise.resolve(new SsrWorker(job.id, job.payload));
  }
}
