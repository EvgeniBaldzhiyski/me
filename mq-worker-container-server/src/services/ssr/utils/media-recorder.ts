import { fromEvent, ignoreElements, merge, Observable, of, Subject, switchMap, tap } from 'rxjs';
import logger from '../../../core/logger';
import blobToBuffer from 'blob-to-buffer';
import config from 'config';

// collect from the MediaRecorder the blob every this timer
const mediaRecorderTimeslice = 2000;

export function mediaRecorder(stream: MediaStream): Observable<Subject<Buffer>> {
  return new Observable<MediaRecorder>(observer => {
    const recorder = new MediaRecorder(stream, {
      mimeType: `video/${config.get('ssr.mimeType')}; codecs=vp9,opus`,
      // Matches SSR v1 see conference/packages/mediasoup-client/src/producer-settings.ts
      // `MOTION_MEDIUM.encodings`
      videoBitsPerSecond: 360000
    });

    logger.debug('RECORDER CREATED AND STARTED...');
    observer.next(recorder);

    return () => {
      recorder.stop();
      logger.debug('RECORDER STOPPED...');
    };
  }).pipe(
    tap(recorder => recorder.start(mediaRecorderTimeslice)),
    switchMap(recorder => {
      const outputStream = new Subject<Buffer>();

      return merge(
        fromEvent(recorder, 'error').pipe(
          tap(({error}: Event & {error: Error}) => {
            throw new Error(`MEDIA STREAM RECORD API FAILED: ${error?.name} ${error?.message}`);
          }),
          ignoreElements(),
        ),
        fromEvent<{data: Blob}>(recorder, 'dataavailable').pipe(
          switchMap(({data}) => new Observable(observer => {
            blobToBuffer(data, (err, buffer) => {
              if (!err) {
                return outputStream.next(buffer);
              }

              observer.error(new Error('FAILED TO CONVERT BLOB TO BUFFER'));
            });
          })),
          ignoreElements(),
        ),
        of(outputStream)
      );
    })
  );
}
