/* eslint-disable @typescript-eslint/no-unsafe-return */
import { catchError, map, Observable, tap } from 'rxjs';
import { v4 } from 'uuid';
import { coreApi } from '../../../communication/core-api.client';
import logger from '../../../core/logger';
import { SsrPayload } from './ssr-payload';
import ContextError from '../../../core/context-error';

interface SsrDto {
  playlistId: SsrPayload['playlistId'];
  title: SsrPayload['title'];
  mid: SsrPayload['mid'];
  meetingAttendeeId: SsrPayload['aid'];
  recordPath: string;
  recordDuration: number;
  fileSize: number;
  startTime: number;
  boRoomId: SsrPayload['rid'];
}

export function sendVideoInformation(
  key: string,
  payload: SsrPayload,
  videoMetadata: {duration: number; size: number; birthtimeMs: number}
): Observable<void> {
  const dto: SsrDto = {
    playlistId: payload.playlistId || v4(),
    title: payload.title || '',
    mid: payload.mid,
    meetingAttendeeId: payload.aid || '',
    recordPath: key,
    recordDuration: videoMetadata.duration,
    fileSize: videoMetadata.size,
    startTime: videoMetadata.birthtimeMs,
    boRoomId: payload.rid
  };

  logger.debug(`NOTIFY .NET CORE WITH ${JSON.stringify(dto, null, 4)}`);

  return coreApi.post<void>('ssr/record/add', dto).pipe(
    map(res => res.data)
  ).pipe(
    tap((res) => {
      logger.log(`NOTIFY .NET CORE SUCCESS ${JSON.stringify(res)}`);
    }),
    catchError(err => {
      if (err.request?.reusedSocket && err.code === 'ECONNRESET') {
        return sendVideoInformation(key, payload, videoMetadata);
      } else {
        throw new ContextError(`Failed to notify CORE API when video was uploaded (${err.message})`, {
          dto
        });
      }
    })
  );
}
