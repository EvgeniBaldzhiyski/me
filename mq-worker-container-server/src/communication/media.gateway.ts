import { ConnectionType, MediaRoom, ProducerFactory, SignalingException } from '@jigsawinteractive/mediasoup-client';
import { catchError, ignoreElements, map, merge, Observable, throwError } from 'rxjs';
import config from 'config';

export function joinInMediaRoom(
  roomId: string,
  username: string,
  attendeeId: string,
  connectionType = ConnectionType.SEND_ONLY
): Observable<{mediaRoom: MediaRoom; producerFactory: ProducerFactory}> {
  const serverUrl = config.get('mediaServer.url');
  const mediaRoom = new MediaRoom({
    serverUrl,
    supportsVideoOrientationHeaderExtension: true,
  });

  return merge(
    mediaRoom.join({ roomId, attendeeId, username, connectionType }).pipe(
      catchError(error => {
        if (error instanceof SignalingException) {
          return throwError(() => new Error(`[SignalingException] ${error.error.message}`));
        } else {
          return throwError(() => new Error(`[MediaRoom] ${error.message || error}`));
        }
      }),
      ignoreElements()
    ),
    mediaRoom.produce$
  ).pipe(
    map(producerFactory => ({mediaRoom, producerFactory}))
  );
}
