/* eslint-disable camelcase */
import { finalize, fromEvent, ignoreElements, map, mapTo, merge, Observable, take, tap, timer } from 'rxjs';
import logger from '../../../core/logger';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import config from 'config';

export interface VideoMetadata {
  streams?: {nb_read_packets: number}[]; // frame count
  format?: Partial<{
    filename: string;
    nb_streams: number;
    nb_programs: number;
    format_name: string;
    format_long_name: string;
    start_time: number;
    duration: number;
    size: number;
    bit_rate: number;
    probe_score: number;
    tags: {
      BIRTHTIME: number;
      ENCODER: string;
    };
  }>;
}

export function getVideoMetadata(fileName: string): Observable<VideoMetadata> {
  const params = [
    '-v', 'quiet', fileName,
    '-print_format', 'json',
    '-count_packets', '-select_streams', 'v:0',
    '-show_entries', 'format:stream=nb_read_packets'
  ];
  const ffprobe = spawn('ffprobe', params);

  logger.debug(`REQUEST FOR FFPROBE PROCESS (ffprobe ${params.join(' ')})`);

  let _ffprobeBuffer = '';

  return merge(
    merge(
      fromEvent<Buffer>(ffprobe.stderr, 'data').pipe(
        map(data => new Error(`FFPROBE.STDERR: ${data?.toString('utf8')}`))
      ),
      fromEvent<Error>(ffprobe, 'error'),
      fromEvent<Error>(ffprobe.stdout, 'error'),
    ).pipe(
      tap(err => {
        throw new Error(`Failed running ffprobe to get video duration. ${err?.message}`);
      }),
      ignoreElements()
    ),
    fromEvent<Buffer>(ffprobe.stdout, 'data').pipe(
      tap(stdoutBuffer => {
        const chunk = stdoutBuffer.toString('utf8');

        logger.debug(`FFPROBE REPORTS CHUNK (${chunk})`);

        _ffprobeBuffer += chunk;
      }),
      ignoreElements()
    ),
    timer(config.get<number>('ssr.ffmpegTimeout') * 1000).pipe(
      tap(() => {
        logger.debug('FFPROBE EXIT TIMEOUT');
        ffprobe.kill('SIGKILL');
      }),
      take(1),
      ignoreElements()
    ),
    fromEvent(ffprobe, 'exit').pipe(
      map(exitCode => {
        try {
          logger.debug(`FFPROBE Exited with CODE: (${exitCode}) AND OUTPUT: ${_ffprobeBuffer}`);

          return JSON.parse(_ffprobeBuffer) as VideoMetadata;
        } catch (err) {
          throw new Error(`FFPROBE was unable to parse input. Exited with CODE: (${exitCode}) and OUTPUT: ${_ffprobeBuffer}.`);
        }
      })
    )
  ).pipe(
    tap(metadata => {
      logger.debug(`FETCH METADATA ${JSON.stringify(metadata)}`);
      if (!metadata) {
        throw new Error('FFPROBE was not able to fetch video metadata.');
      }
    }),
    take(1),
    finalize(() => {
      ffprobe.kill('SIGKILL');
    })
  );
}

export function videoGenerator(fileName: string): Observable<ChildProcessWithoutNullStreams> {
  const params = [
    '-i', 'pipe:0',
    '-metadata', `birthtime=${Date.now()}`,
    '-metadata', 'created_by=Jigsaw',
    '-c:v', 'copy',
    '-c:a', 'copy',
    fileName
  ];
  const ffmpeg = spawn('ffmpeg', params);

  logger.debug(`REQUEST FOR FFMPEG PROCESS (ffmpeg ${params.join(' ')})`);

  return merge(
    merge(
      fromEvent<Buffer>(ffmpeg.stdout, 'data').pipe(
        tap(data => logger.debug(`FFPROBE.STDOUT: ${data?.toString('utf8')}`))
      ),
      fromEvent<Buffer>(ffmpeg.stderr, 'data').pipe(
        tap(data => {
          const row = data?.toString('utf8');

          logger.debug(row);
        })
      ),
      merge(
        fromEvent(ffmpeg.stdin, 'error'),
        fromEvent(ffmpeg, 'error')
      ).pipe(
        tap((err: Error) => {
          logger.error(`FFMPEG throws an error (${err.message})`);

          throw new Error(`FFMPEG throws an error (${err.message})`);
        }),
      )
    ).pipe(
      ignoreElements()
    ),
    fromEvent(ffmpeg, 'spawn').pipe(
      tap(() => logger.debug('FFMPEG PROCESS IS SPAWNED')),
      mapTo(ffmpeg)
    )
  ).pipe(
    finalize(() => {
      logger.debug('REQUEST STOP FFMPEG');

      ffmpeg.stdin.write('q');
      ffmpeg.stdin.end();
    })
  );
}
