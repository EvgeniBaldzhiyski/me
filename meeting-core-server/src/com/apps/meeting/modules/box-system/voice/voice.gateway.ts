import { ApmTransaction, TransactionType } from '@container/apm-utils';
import { Attendee, Model, RestAPI, Room, ServerConnectionAPI, ServerRestAPI } from '@container/models';
import apm from 'elastic-apm-node/start';
import { Observable, of, Subject } from 'rxjs';
import { catchError, filter, map, tap } from 'rxjs/operators';
import { client } from '../../../../../gateway/decorators/argument.decorator';
import { Get, Post, Socket } from '../../../../../gateway/decorators/method.decorator';
import { gatewayScanner } from '../../../../../gateway/manager';
import { JwtSubjects } from '../../../../../gateway/types';
import Client from '../../../../../utils/Client';
import { coreApiObservable } from '../../../../../utils/coreApiClient';
import ServerAPI from '../../../../../utils/ServerAPI';
import { VoiceCandidate, VoiceSpeaking, CallSid, VoiceGatewayEvent, VoiceGatewayEventType, VoiceGatewayCommandRes } from './voice.interfaces';
import { Logger } from 'winston';

export class VoiceGateway {
  private event$ = new Subject<VoiceGatewayEvent>();

  constructor(
    private server: ServerAPI,
    private logger: Logger,
    private mid: Model['meetingID'],
    private mrunid: Model['meetingRunID']
  ) {
    gatewayScanner(this, this.server);
  }

  requestEvent<T extends VoiceGatewayEvent = VoiceGatewayEvent>(type: T['type']): Observable<T['data']> {
    this.logger.debug(`[VOICE GATEWAY] request for event(${type})`);

    return this.event$.pipe(
      filter(event => event.type === type),
      map(({data}) => data),
      tap(data => {
        this.logger.debug(`[VOICE GATEWAY] request query triggered for event(${type})`, data);
      })
    );
  }

  @Post(ServerRestAPI.PHONE_JOIN, [JwtSubjects.CORE_API_SERVER])
  @ApmTransaction(TransactionType.REQUEST)
  private onPhoneJoin({ callSid }: {aid: Attendee['id'], callSid: string}) {
    this.event$.next({type: VoiceGatewayEventType.JOIN, data: callSid});
  }

  @Post(ServerRestAPI.PHONE_CALL, [JwtSubjects.CORE_API_SERVER])
  @ApmTransaction(TransactionType.REQUEST)
  private onPhoneRequest(candidate: VoiceCandidate) {
    this.event$.next({type: VoiceGatewayEventType.REQUEST, data: candidate});
  }

  @Post(ServerRestAPI.PHONE_SPEAKING, [JwtSubjects.CORE_API_SERVER])
  @ApmTransaction(TransactionType.REQUEST)
  private onPhoneSpeakingHandler(params: VoiceSpeaking) {
    this.event$.next({type: VoiceGatewayEventType.SPEAKING, data: params});
  }

  @Socket(ServerConnectionAPI.PHONE_DIAL_OUT)
  private onDialOut(@client cln: Client, id) {
    this.event$.next({type: VoiceGatewayEventType.DIAL_OUT, data: {
      reqOwner: cln.data.aid,
      aid: id
    }});
  }

  @Socket(ServerConnectionAPI.PHONE_CALL_ME)
  private onCallme(@client cln: Client, {ext, code, phone}) {
    this.event$.next({type: VoiceGatewayEventType.CALL_ME, data: {
      reqOwner: cln.data.aid,
      aid: cln.data.aid,
      extension: ext,
      code,
      phone
    }});
  }

  /**
   * @tool Simulate connection drop in both directions
   *
   * @link https://sock.local.interactive.com/meeting/<MID>/refresh-ssr-client[?server=1][&room=<RID>][&kill=1]
   */
  @Get('refresh-voice-client') // @SUT
  private onRefreshSsrClient(params: {
    room: Room['id'],
    server: 1 | 0 | void,
    kill: 1 | 0 | void
  }) {
    this.event$.next({type: VoiceGatewayEventType.REF_CLIENT, data: {
      room: params.room,
      server: params.server ? 1 : 0,
      kill: params.kill ? 1 : 0
    }});
  }

  holdPhone(callSid: CallSid | CallSid[], text = ''): Observable<VoiceGatewayCommandRes | null> {
    this.logger.debug('[VOICE GATEWAY] HOLD PHONES', {callSid, text, stack: new Error('').stack});

    if (!callSid || (Array.isArray(callSid) && callSid.length === 0)) {
      return of(null);
    }
    return coreApiObservable.post(RestAPI.TWILIO_HOLD, {
      mid: this.mid,
      cid: (Array.isArray(callSid) ? callSid : [callSid]).join(','),
      msg: text,
      hold: (!!text ? 1 : 0),
    }).pipe(
      catchError(err => {
        return of({
          status: err.response?.status || 500,
          statusText: err.response?.statusText || err.message
        });
      }),
      tap(({status, statusText}) => {
        if (status !== 200) {
          this.logger.error(`hold phone return bad status ${status}(${statusText})`);
          apm.captureError(`hold phone return bad status ${status}(${statusText})`, {
            custom: {
              mid: this.mid,
              mrunid: this.mrunid,
              callSid: callSid
            }
          });
        }
        this.logger.debug('[VOICE GATEWAY] HOLD PHONES (RES)', {callSid, text, status, statusText});
      }),
    );
  }

  mutePhone(callSid: CallSid | CallSid[], mute: boolean): Observable<VoiceGatewayCommandRes | null> {
    this.logger.debug('[VOICE GATEWAY] MUTE PHONES', {callSid, mute, stack: new Error('').stack});

    if (!callSid || (Array.isArray(callSid) && callSid.length === 0)) {
      return of(null);
    }
    return coreApiObservable.post<''>(RestAPI.TWILIO_MUTE, {
      mid: this.mid,
      cid: (Array.isArray(callSid) ? callSid : [callSid]).join(','),
      mute: (mute ? 1 : 0),
    }).pipe(
      catchError(err => {
        return of({
          status: err.response?.status || 500,
          statusText: err.response?.statusText || err.message
        });
      }),
      tap(({status, statusText}) => {
        if (status !== 200) {
          this.logger.error(`mute phone return bad status ${status}(${statusText})`);
          apm.captureError(`mute phone return bad status ${status}(${statusText})`, {
            custom: {
              mid: this.mid,
              mrunid: this.mrunid,
              callSid: callSid
            }
          });
        }
        this.logger.debug('[VOICE GATEWAY] MUTE PHONES (RES)', {callSid, mute, status, statusText});
      }),
    );
  }

  movePhone(callSid: CallSid | CallSid[], to: Room['id']): Observable<VoiceGatewayCommandRes | null> {
    this.logger.debug('[VOICE GATEWAY] MOVE PHONES', {callSid, to});

    if (!callSid || (Array.isArray(callSid) && callSid.length === 0)) {
      return of(null);
    }
    return coreApiObservable.post(RestAPI.TWILIO_MOVE, {
      mid: this.mid,
      cid: (Array.isArray(callSid) ? callSid : [callSid]).join(','),
      // @todo revise room names and logic how they are used
      to: `${this.mid}${to ? `_${to}` : ''}`,
      hasJoin: 0 // @todo check this param
    }).pipe(
      catchError(err => {
        return of({
          status: err.response?.status || 500,
          statusText: err.response?.statusText || err.message
        });
      }),
      tap(({status, statusText}) => {
        if (status !== 200) {
          this.logger.error(`move phone return bad status ${status}(${statusText})`);
          apm.captureError(`move phone return bad status ${status}(${statusText})`, {
            custom: {
              mid: this.mid,
              mrunid: this.mrunid,
              callSid: callSid
            }
          });
        }
        this.logger.debug('[VOICE GATEWAY] MOVE PHONES (RES)', {callSid, to, status, statusText});
      }),
    );
  }

  kickPhone(callSid: CallSid | CallSid[], reason = ''): Observable<VoiceGatewayCommandRes | null> {
    this.logger.debug('[VOICE GATEWAY] KICK PHONES', {callSid, reason});

    if (!callSid || (Array.isArray(callSid) && callSid.length === 0)) {
      return of(null);
    }
    return coreApiObservable.post(RestAPI.TWILIO_KICKOUT, {
      mid: this.mid,
      cid: (Array.isArray(callSid) ? callSid : [callSid]).join(','),
      msg: reason
    }).pipe(
      catchError(err => {
        return of({
          status: err.response?.status || 500,
          statusText: err.response?.statusText || err.message
        });
      }),
      tap(({status, statusText}) => {
        if (status !== 200) {
          this.logger.error(`kick phone return bad status ${status}(${statusText})`);
          apm.captureError(`kick phone return bad status ${status}(${statusText})`, {
            custom: {
              mid: this.mid,
              mrunid: this.mrunid,
              callSid: callSid
            }
          });
        }
        this.logger.debug('[VOICE GATEWAY] KICK PHONES (RES)', {callSid, reason, status, statusText});
      }),
    );
  }

  announcePhone(callSid: CallSid | CallSid[], rid: Room['id'], message: string): Observable<VoiceGatewayCommandRes | null> {
    this.logger.debug('[VOICE GATEWAY] ANNOUNCE PHONES', {callSid, message});

    if (!callSid || (Array.isArray(callSid) && callSid.length === 0)) {
      return of(null);
    }
    return coreApiObservable.post(RestAPI.TWILIO_ANNOUNCE, {
      mid: this.mid,
      rid: `${this.mid}${rid ? `_${rid}` : ''}`,
      cid: (Array.isArray(callSid) ? callSid : [callSid]).join(','),
      msg: message
    }).pipe(
      catchError(err => {
        return of({
          status: err.response?.status || 500,
          statusText: err.response?.statusText || err.message
        });
      }),
      tap(({status, statusText}) => {
        if (status !== 200) {
          this.logger.error(`announce phone return bad status ${status}(${statusText})`);
          apm.captureError(`announce phone return bad status ${status}(${statusText})`, {
            custom: {
              mid: this.mid,
              mrunid: this.mrunid,
              callSid: callSid
            }
          });
        }
        this.logger.debug('[VOICE GATEWAY] ANNOUNCE PHONES (RES)', {callSid, message, status, statusText});
      }),
    );
  }

  callMe(
    extension: string,
    code: number,
    phone: number,
    {id, room}: Attendee
  ): Observable<VoiceGatewayCommandRes<{
    number: string,
    sid: string,
  }> | null> {
    this.logger.debug('[VOICE GATEWAY] CALL ME', {code, phone, id});

    return coreApiObservable.post<any>(
      RestAPI.TWILIO_CALL_ME,
      {
        mid: this.mid,
        aid: id,
        extension,
        phone: `${code}${phone}`,
        isInBOR: (room ? 1 : 0)
      }
    );
  }
}
