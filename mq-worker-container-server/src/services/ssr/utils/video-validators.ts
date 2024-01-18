import { catchError, defer, from, mapTo, Observable, Subscriber, throwError } from 'rxjs';
import config from 'config';
import { PathLike } from 'fs';
import { access } from 'fs/promises';
import { VideoMetadata } from './video-generator';

export class MinDurationValidator extends Error { }

export class FileExistValidator extends Error { }

export function validateMinDuration() {
  return (source: Observable<VideoMetadata>): Observable<VideoMetadata | never> =>
    new Observable((subscriber: Subscriber<VideoMetadata>) =>
      source.subscribe({
        next(metadata) {
          if ((metadata?.format?.duration || 0) <= config.get('ssr.minVideoLength')) {
            subscriber.error(new MinDurationValidator(
              `Video duration validator is failed. Received ${metadata?.format?.duration} but expected ${config.get('ssr.minVideoLength')}`
            ));
            subscriber.complete();
            return;
          }
          subscriber.next(metadata);
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          subscriber.complete();
        }
      })
    );
}

export function validateFileExists(path: PathLike): Observable<PathLike> {
  // in rare cases when ffmpeg buffers first frames of the recording we can receive command STOP
  // in this case file is not created but rxjs chain continues and tries to upload a file
  // this validator prevents this behavior
  return defer(() => from(access(path)).pipe(
    catchError(({message}) => throwError(() => new FileExistValidator(message))),
    mapTo(path)
  ));
}
