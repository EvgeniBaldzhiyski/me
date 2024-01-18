import { catchError, from, fromEvent, ignoreElements, map, merge, Observable, of, switchMap, tap, throwError } from 'rxjs';
import config from 'config';
import { basename } from 'path';
import { createReadStream } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SsrPayload } from './ssr-payload';
import logger from '../../../core/logger';
import ContextError from '../../../core/context-error';

const client = new S3Client(config.get('aws.s3.settings'));

export type fileMetadataKeys = 'titleEncoded' | 'mid' | 'aid' | 'mrunid' | 'rid' | 'videoId' | 'playlistId';

/**
 * Converts SessionMetadata to a generic object that S3 library understands. Also, sanitizes the data to be
 * acceptable by the storage service.
 */
function convertMetadata({title, mid, aid, rid, mrunid, videoId, playlistId}: SsrPayload): Record<fileMetadataKeys, string> {
  return {
    titleEncoded: encodeURIComponent(title),
    mid: encodeURIComponent(mid),
    aid: encodeURIComponent(aid),
    rid: encodeURIComponent(rid),
    mrunid: encodeURIComponent(mrunid),
    videoId: encodeURIComponent(videoId),
    playlistId: encodeURIComponent(playlistId),
  };
}

export function videoUploader(source: string, payload: SsrPayload): Observable<{bucket: string; key: string; etag: string} | never> {
  logger.debug('UPLOAD FILE');

  const metadata = convertMetadata(payload);
  const stream = createReadStream(source);

  return of({
    Body: stream,
    Bucket: `${config.get('aws.s3.bucket')}`,
    Key: `${config.get('aws.s3.prefix')}${payload.mid}/${basename(source)}`,
    ContentType: `video/${config.get('ssr.mimeType')}`,
    Metadata: metadata,
    ACL: 'bucket-owner-full-control'
  }).pipe(
    switchMap(putOptions => merge(
      fromEvent<Error>(stream, 'error').pipe(
        tap(err => {
          err.message = `Unable to read file: ${err.message}`;
          throw err;
        }),
        ignoreElements()
      ),
      from(client.send(new PutObjectCommand(putOptions)))
    ).pipe(
      map(res => ({ bucket: putOptions.Bucket, key: putOptions.Key, etag: `${res.ETag}`})),
      tap((res) => {
        logger.log(`S3 UPLOAD SUCCESS : ${JSON.stringify(res)}`);
      }),
    )),
    tap(() => stream?.close()),
    catchError(err => {
      stream?.close();

      // @todo metadata like context or better
      return fromEvent(stream, 'close').pipe(
        switchMap(() => throwError(() => new ContextError(`The video upload has been failed because (${err.message})`, {
          source
        })))
      );
    })
  );
}
