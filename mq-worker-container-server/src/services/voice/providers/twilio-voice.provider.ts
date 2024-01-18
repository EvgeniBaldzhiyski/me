/* eslint-disable @typescript-eslint/ban-ts-comment */
import { catchError, from, fromEvent, ignoreElements, map, merge, Observable, of, switchMap, take, tap } from 'rxjs';
import { VoiceProvider } from './voice-provider.interface';
import { coreApi } from '../../../communication/core-api.client';
import { Device, Call, TwilioError } from '@twilio/voice-sdk';
import logger from '../../../core/logger';

export class TwilioVoiceProvider implements VoiceProvider {
  exchange(mid: string, rid: string, mediaStream: MediaStream): Observable<MediaStream> {
    return this.connect(mid, rid, mediaStream);
  }

  private getTwilioAccessToken(mid: string): Observable<string> {
    logger.debug('ASK FOR TWILIO TOKEN');

    return coreApi.get<string>(`/twilio/token/${mid}`).pipe(
      map(res => res.data)
    ).pipe(
      catchError(err => {
        throw new Error(`Failed to notify CORE API when token was fetched (${err.message})`);
      })
    );
  }

  private getDevice(mid: string, fileInputStream: MediaStream): Observable<Device> {
    return this.getTwilioAccessToken(mid).pipe(
      switchMap(token => new Observable<Device>(observer => {
        logger.debug(`GEN DEVICE ${token}`);

        const device = new Device(token, {
          // NOTE: This an internal option and may stop working in any new version, another option is to use `private _updateInputStream()`
          // @see https://github.com/twilio/twilio-voice.js/blob/4059600d15f6c2301940711c63c52eea474ae01d/lib/twilio/device.ts#L967
          // @see https://github.com/twilio/twilio-voice.js/blob/4059600d15f6c2301940711c63c52eea474ae01d/lib/twilio/device.ts#L1450
          // @ts-ignore
          fileInputStream
        });

        observer.next(device);

        return () => {
          device.destroy();
        };
      }).pipe(
        switchMap(device => merge(
          merge(
            fromEvent(device, Device.EventName.Unregistered).pipe(
              tap(() => { throw new Error('Device unregistered error'); })
            ),
            fromEvent(device, Device.EventName.Registered).pipe(
              tap(() => { throw new Error('Device unregistered error'); })
            ),
            fromEvent(device, Device.EventName.Error).pipe(
              tap(([error]) => {
                if (!(error instanceof TwilioError.AuthorizationErrors.AccessTokenExpired)) {
                  throw new Error(`Device error (${error.message})`);
                }
              })
            ),
          ).pipe(
            ignoreElements()
          ),
          of(device)
        ))
      ))
    );
  }

  private connect(mid: string, SipCallId: string, fileInputStream: MediaStream): Observable<MediaStream> {
    return this.getDevice(mid, fileInputStream).pipe(
      switchMap(device => from(device.connect({
        params: {SipCallId}
      })).pipe(
        tap((call: Call) => logger.debug(`DEVICE IS CONNECTED ${call.status()}`)),
        switchMap((call: Call) => merge(
          merge(
            fromEvent(call, 'disconnect').pipe(
              tap(() => {
                logger.log('-------------------------Call is disconnected');
                throw new Error('Call is disconnected');
              })
            ),
            fromEvent(call, 'error').pipe(
              tap(({code, message}: TwilioError.TwilioError) => {
                throw new Error(`Connection error (${code}/${message})`);
              })
            ),
            fromEvent(call, 'warning').pipe(
              tap(warning => logger.warn(`Twilio connection warning: ${JSON.stringify(warning)}`))
            ),
            fromEvent(call, 'warning-cleared').pipe(
              tap(warning => logger.log(`Twilio connection warning cleared: ${warning}`))
            ),
            fromEvent(call, 'reconnecting').pipe(
              tap(({code, message}: TwilioError.TwilioError) =>
                logger.warn(`Twilio connection reconnecting: (${code}/${message})`)
              )
            ),
            fromEvent(call, 'reconnected').pipe(
              tap(() => logger.log('Twilio connection reconnected'))
            )
          ).pipe(
            ignoreElements()
          ),
          fromEvent(call, 'sample').pipe(
            map(() => {
              const stream = call.getRemoteStream();

              logger.debug(`OUTPUT STREAM IS GENERATED ${stream.active}`);

              return stream;
            }),
            take(1)
          ),
        ))
      ))
    );
  }
}
