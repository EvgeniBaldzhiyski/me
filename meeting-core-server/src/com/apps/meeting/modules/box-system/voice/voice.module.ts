import BaseModule from '../../BaseModule';
import {
  Attendee, BoxWorkerState, BoxWorkerStatus, ClientConnectionAPI,
  ErrorCodes, MicState, Roles, Room, SessionAudio
} from '@container/models';
import { BoxWorker } from '../utils/workers/box.worker';
import {
  fromEvent, merge, of, Subject, Subscription, from, Observable, timer, concat, forkJoin, NEVER, defer, iif, EMPTY
} from 'rxjs';
import {
  catchError, delay, filter, finalize, map,
  mergeMap, switchMap, take, takeUntil, takeWhile, tap
} from 'rxjs/operators';
import { NoMainPresenterEvent, NoMainPresenterTimeoutEvent, SessionEventTypes } from '../../../events/SessionEvents';
import { BoxWorkerBasePayload, BoxWorkerMongodbSchema } from '../utils/workers/box.worker.interface';
import config from 'config';
import { VoiceWorker } from './voice.worker';
import apm from 'elastic-apm-node/start';
import {
  VoiceCandidateItem, VoiceSpeaking, CallSid, VoiceGatewayEventType,
  VoiceGatewayRequest, VoiceGatewayJoin, VoiceGatewayCallme, VoiceRefClient, VoiceDialOut
} from './voice.interfaces';
import { VoiceGateway } from './voice.gateway';

type callSid = Attendee['phoneAudio'];

// @todo remove from code service the message and allow phone to join if session is not started
// @todo allow phones to be active if presenter (phone or comp) is online

export default class VoiceModule extends BaseModule {
  private static anonymousId = 0;

  // protected stateCollection = defaultDb().collection(DB_COLLECTIONS.VOICE_MODULE_STATE);
  private workerStore: Map<Room['id'], { worker: VoiceWorker, subscriptions: Subscription }> = new Map();

  private phantoms = new Map<CallSid, number>();
  private candidateItems = new Map<CallSid, VoiceCandidateItem>();

  // can't be merged because callMeRequests must to be cleared when http request completes,
  // but callMeInProgress have to be keep in live to the moment phone either comes in or goes out
  private callMeRequests = new Set<Attendee['id']>();
  private callMeInProgress = new Map<Attendee['id'], {req: Attendee['id'], callSid: CallSid}>();

  private movePhonesInProgress = new Map<CallSid, {aid: Attendee['id']; fromRid: Room['id']; ssrInProgress?: boolean}>();

  private workerChangeState$ = new Subject<{id: BoxWorker['id'], state: BoxWorkerState}>();

  private roomsSSRState = new Map<Room['id'], boolean>();

  private voiceGateway: VoiceGateway = new VoiceGateway(
    this.inst.server,
    this.inst.logger,
    this.inst.model.meetingID,
    this.inst.model.meetingRunID
  );

  private enableRecordingNotification = false;

  private afterSendRecordMessageTimeout = 5;

  async setup(): Promise<void> {
    await super.setup();
    // await this.loadState();

    this.enableRecordingNotification = this.inst.model.sessionSettings.enableRecordingNotification;

    this.inst.updateEngine.registerApprover(this);

    this.bindModuleEvents().subscribe();
  }

  async beforeDestruct(code?: ErrorCodes): Promise<void> {
    /** @todo
     * kick all phones if session is shutdown. No meter the reason
     * remove this section when activeMeetingContext starts
     */
     await this.kickAllAttendeesInRoomWithReason('Server has been restarted. Please join in later.').toPromise();

    if (code === ErrorCodes.SERVER_RESTART) {
      // await this.saveState();

      /** @todo
       * prevent the case in the state to have attached phones
       * remove this section when activeMeetingContext starts.
       */
      /** @fixme
       * attendee list is stored before module to make the required updates,
       * so after server restart still has attendees with attached phones
       */
      const array = [];
      for (const [, attendee] of this.inst.attendeeStorage.getAttendees()) {
        if (attendee.phoneAudio) {
          array.push(this.inst.updateEngine.approveAndApplyData(null, {id: attendee.id, data: {phoneAudio: ''}}));
        }
      }
      await Promise.all(array);
    }

    this.workerStore.forEach(({worker}) => {
      if (worker.getCurrentStatus() !== BoxWorkerStatus.STOP) {
        this.stopWorker(worker.id);
      }
    });

    return super.beforeDestruct(code);
  }

  async approveAttendeeChange(_, id: Attendee['id'], data: Partial<Attendee>, done) {
    const attendee = this.inst.attendeeStorage.getAttendeeById(id);
    const room = this.inst.model.roomsIndex[attendee?.room];

    if (!room || !attendee) {
      return done(data);
    }

    // phone come but attendee is kicked out. Kicks phone and reject the update
    if (data.phoneAudio && attendee.kickedOut) {
      this.voiceGateway.kickPhone(data.phoneAudio, 'You have been kicked out of this session and are not allowed to rejoin').toPromise();
      return done(null);
    }

    // computer left but there has still phone attached
    if (data.left && attendee.phoneAudio && attendee.role !== Roles.PHONE) {
      // reset isAway because phone only can't manipulate it
      data.isAway = false;
      // comp left but phone is still here so reset left
      data.left = false;
      // phone only has to have only role PHONE
      data.role = Roles.PHONE;
    }

    // phone is coming or leaving
    if (('phoneAudio' in data)) {
      if (data.phoneAudio) {
        if (attendee.left) {
          data.left = false;
          data.role = Roles.PHONE;

          if (attendee.isAway) {
            data.isAway = false;
          }
        }
      } else {
        if (attendee.role === Roles.PHONE) {
          data.left = true;
        }
      }
    }

    // adjust mic state in case session phone only
    if (this.inst.model.sessionSettings.audio[0] === SessionAudio.PHONE_ONLY && data.micState === MicState.missing) {
      if (room.enabledAllMic) {
        data.micState = MicState.denied;
      } else {
        data.micState = MicState.normal;
      }

      data.hasMic = true;
    }

    const lastState = attendee.micState;

    await done(data);

    // adjust a phone status in the provider side
    if (attendee.phoneAudio) {
      this.inst.logger.debug(`Attendee(${attendee.id}/${attendee.phoneAudio}) has been moved in room(${attendee.room}`);
      // attendee with phone changes the room, we have to wait join before we make any actions
      if (('room' in data)) {
        this.inst.logger.debug(`Register attendee(${attendee.id}/${attendee.phoneAudio}) in move and request for move`);
        // register moving
        this.movePhonesInProgress.set(attendee.phoneAudio, {aid: attendee.id, fromRid: room.id, ssrInProgress: this.roomsSSRState.get(room.id)});
        // send command and wait to be joined before a mic state adjustment @todo have to be edited after backed reworking
        await this.voiceGateway.movePhone(attendee.phoneAudio, data.room).toPromise();
      } else {
        // attendee with phone has changed a mic state BUT NOT ROOM and this is not attendee initialization pipe
        if (('micState' in data) && !('attendeeAdded' in data)) {
          await this.mutePhoneAfterChangeState(attendee, lastState).toPromise();
        }

        // is away state is changed
        if ('isAway' in data) {
          if (attendee.isAway) {
            await this.voiceGateway.mutePhone(attendee.phoneAudio, true).toPromise();
          } else {
            if (!this.shouldMute(attendee)) {
              await this.voiceGateway.mutePhone(attendee.phoneAudio, false).toPromise();
            }
          }
        }
      }

      // phone (JOINED) is coming in the session
      if ((
        ('phoneAudio' in data) || // phone is coming for available attendee
        ('attendeeAdded' in data)  // phone is coming but there is still does not have any attendee
      )) {
        this.inst.logger.debug(`Attendee(${attendee.id}/${attendee.phoneAudio}) joins in room(${attendee.room})`);
        // @todo rework it when getActiveMeetingContext endpoint is introduced
        // phone is attached in bor, so we have to wait to join first
        if (attendee.room !== '') {
          this.inst.logger.debug(`Register attendee(${attendee.id}/${attendee.phoneAudio}) in move list`);
          this.movePhonesInProgress.set(attendee.phoneAudio, {aid: attendee.id, fromRid: null});

          await this.voiceGateway.movePhone(data.phoneAudio, attendee.room).toPromise();
        } else {
          await this.attachPhonePipe(attendee.phoneAudio, attendee.room).toPromise();
        }
      }

      // phone (with or without attendee) got been kicked out
      if (('kickedOut' in data)) {
        await this.voiceGateway.kickPhone(
          attendee.phoneAudio,
          `You have been kicked out of this session. Reason: ${data.kickedOut}`
        ).toPromise();
      }

      // clear idle time if attendee with phone returns
      if (('left' in data) && !attendee.left && attendee.role === Roles.PHONE) {
        this.inst.logger.debug(`Clear remove delay for attendee(${attendee.id})`);

        this.inst.clearRemoveAttendeeDelay(attendee.id);
      }
    }

    // setup idle time if phone without attendee disconnects
    if (('left' in data) && attendee.left && attendee.role === Roles.PHONE) {
      if (attendee.staticRole === Roles.PHONE) {
        this.inst.logger.debug(`Phone(${attendee.id}/${attendee.phoneAudio}) has been removed immediately`);

        this.inst.removeAttendee(attendee.id);
      } else {
        this.inst.logger.debug(`Setup remove delay for attendee(${attendee.id})`);

        this.inst.setupRemoveAttendeeDelay(attendee.id);
      }
    }

    // check workers in all cases (possible cases:)
    //  - attendee without phone but there has a candidate associated (worker is still in init state)
    //  - attendee with phone
    //  - active phone has changed the room
    if (('room' in data)) {
      this.inst.logger.debug(`Attendee(${attendee.id}/${attendee.phoneAudio}) has moved in room(${attendee.room}). Check new room for worker.`);

      this.toggleWorkerInRooms([room.id, attendee.room]);
    }
  }

  private mutePhoneAfterChangeState(attendee: Attendee, prevState: MicState): Observable<any> {
    if (attendee.micState !== prevState && attendee) {
      if (this.shouldMute(attendee)) {
        return this.voiceGateway.mutePhone(attendee.phoneAudio, true);
      }

      if (prevState === MicState.denied && !this.shouldMute(attendee)) {
        this.onPhoneSpeaking({aid: attendee.id, callSid: attendee.phoneAudio, speaking: '1'});
        return this.voiceGateway.mutePhone(attendee.phoneAudio, false);
      }
    }

    return of(null);
  }

  private bindModuleEvents(): Observable<void> {
    return merge(
      this.voiceGateway.requestEvent(VoiceGatewayEventType.DIAL_OUT).pipe(
        map(({aid}: VoiceDialOut) => {
          const attendee = this.inst.attendeeStorage.getAttendeeById(aid);

          return attendee.phoneAudio;
        }),
        filter(cid => !!cid),
        mergeMap(cid => {
          this.inst.logger.debug(`phone(${cid}) is kicked because DIAL_OUT command`);
          return this.voiceGateway.kickPhone(cid);
        })
      ),
      this.voiceGateway.requestEvent(VoiceGatewayEventType.SPEAKING).pipe(
        tap((data: VoiceSpeaking) => this.onPhoneSpeaking(data)),
      ),
      this.voiceGateway.requestEvent(VoiceGatewayEventType.REF_CLIENT).pipe(
        filter(() => !!config.get('sut.enabled')),
        tap(({room, server, kill}: VoiceRefClient) => {
          const worker = this.getWorker(room || '');

          if (!worker?.hasJob()) {
            return;
          }

          for (const [, attendee] of this.inst.attendeeStorage.getAttendeeMapByRoomId(worker.id)) {
            if (attendee.staticRole === Roles.MIXER && !attendee.left) {
              for (const [_, client] of this.inst.server.clients) {
                if (server) {
                  this.inst.server.disconnect(client.id, (kill ? ErrorCodes.KILL : 0));
                } else {
                  this.inst.server.sendTo(ClientConnectionAPI.REFRESH_CONNECTION, undefined, client.id);
                }
                return;
              }
            }
          }
        })
      ),
      fromEvent(this.inst.eventBus, SessionEventTypes.ROOM_BEFORE_CLOSE).pipe(
        tap((rid: Room['id']) => {
          this.inst.logger.debug(`worker(${rid}) is stopping because ROOM_BEFORE_CLOSE command`);
          this.stopWorker(rid);
        })
      ),
      this.voiceGateway.requestEvent<VoiceGatewayCallme>(VoiceGatewayEventType.CALL_ME).pipe(
        map(({reqOwner, aid, ...rest}) => ({
          target: this.inst.attendeeStorage.getAttendeeById(aid),
          requester: this.inst.attendeeStorage.getAttendeeById(reqOwner),
          data: rest
        })),
        tap(({target, requester}) => {
          this.inst.logger.debug('call me request is made', {
            target,
            requester,
            hasReq: this.callMeRequests.has(target?.id),
            isInProgress: this.callMeInProgress.has(target?.id)
          });
        }),
        mergeMap(({requester, target, data: {extension, code, phone}}) => {
          if (!this.shouldMakeCallMe({requester, target})) {
            return of(undefined);
          }

          this.callMeRequests.add(target.id);

          return this.voiceGateway.callMe(extension, code, phone, target).pipe(
            catchError(err => {
              this.inst.logger.error(`call me error ${err.response?.status}, ${err.response?.statusText}, ${err.response.message}`);

              return of({
                status: err.response?.data?.errNo || 500,
                data: err.response?.data?.message || err.message
              });
            }),
            tap(({status, data}) => {
              this.inst.logger.debug(`call me is going in progress ${status}`, data);

              if (status !== 200) {
                const error = new Error(`CALLME FAIL [${status}] ${data}`);
                apm.captureError(error);
                this.inst.logger.error(error.message);

                this.inst.sendToAttendee(requester.id, ClientConnectionAPI.PHONE_CALL_ME, { code: status, message: data.error });
                return;
              }

              this.callMeInProgress.set(target.id, {req: requester.id, callSid: data.sid});
              this.inst.logger.debug(`CALLME SUCCESS [${JSON.stringify(data)}]`);
              this.inst.sendToAttendee(requester.id, ClientConnectionAPI.PHONE_CALL_ME, { code: status, message: (data.number || data) });
            }),
            // TODO: REMOVE ME AND MOVE TO CLIENT APP TO RELOAD CALL ME STATE AND TRY TO CALL AGAIN
            switchMap(({status}) => {
              if (status !== 200) {
                return timer(+config.get('boxSystem.voice.resetCallMeState')).pipe(
                  tap(() => {
                    this.inst.sendToAttendee(requester.id, ClientConnectionAPI.PHONE_CALL_ME, null);
                  })
                );
              }
              return of(null);
            }),
            finalize(() => {
              this.callMeRequests.delete(target.id);
            })
          );
        })
      ),
      fromEvent(this.inst.eventBus, NoMainPresenterTimeoutEvent.type).pipe(
        switchMap((message: string) => {
          return this.kickAllAttendeesInRoomWithReason(message);
        })
      ),
      iif(
        () => this.enableRecordingNotification,
        fromEvent(this.inst.eventBus, SessionEventTypes.SSR_STATUS).pipe(
          map(({status, id}) => ({started: status === BoxWorkerStatus.STARTED, id})),
          mergeMap(({id, started}) => {
            const roomSSRState = this.roomsSSRState.get(id) || false;

            if (started !== roomSSRState && this.inst.roomEngine.hasAnyPresenter) {
              this.roomsSSRState.set(id, started);

              const attendees = this.inst.attendeeStorage.getAttendeeMapByRoomId(id);

              const cids = [];
              for (const [, attendee] of attendees) {
                if (attendee.phoneAudio) {
                  cids.push(attendee.phoneAudio);
                }
              }
              return this.attachPhonePipe(cids, id, id);
            }
            return NEVER;
          })
        ),
        NEVER
      ),
      fromEvent(this.inst.eventBus, NoMainPresenterEvent.type).pipe(
        filter(() => !!this.workerStore.size),
        switchMap((notAvailable: boolean) => {
          // all attendees with attach phone
          const ids: CallSid[] = [];
          // list of attendees in muted rooms
          const muteIds: CallSid[] = [];

          for (const [, attendee] of this.inst.attendeeStorage.getAttendees()) {
            if (attendee.phoneAudio) {
              if (this.shouldMute(attendee)) {
                muteIds.push(attendee.phoneAudio);
              }
              ids.push(attendee.phoneAudio);
            }
          }

          if (!ids.length) {
            return of(undefined);
          }

          if (notAvailable) {
            return this.voiceGateway.holdPhone(ids, 'Please wait for the presenter to join the session.');
          } else {
            this.inst.logger.debug('hold and mute phones because presenter is coming', {ids, muteIds});
            return concat(
              this.voiceGateway.holdPhone(ids),
              // @todo try to fix after backend service changes. There has a way in one request to specify mute and hold
              // unhold removes a previous mute, so we mute phones after a successful hold again
              this.voiceGateway.mutePhone(muteIds, true),
            );
          }
        }),
      ),
      fromEvent(this.inst.eventBus, SessionEventTypes.REFRESH_SETTINGS).pipe(
        switchMap(() => {
          if (
            this.inst.model.sessionSettings.audio[0] === SessionAudio.COMPUTER_ONLY ||
            this.inst.model.sessionSettings.audio[0] === SessionAudio.EXTERNEL_LINE
          ) {
            return this.kickAllAttendeesInRoomWithReason('The session audio mode has been changed. Good bye.');
          }
          return of(undefined);
        })
      ),
      this.workerChangeState$.pipe(
        mergeMap(event => {
          const {id, state: {status}} = event;
          this.inst.logger.debug(`worker(${id} change status to(${status}))`);

          if (status === BoxWorkerStatus.STOP) {
            return this.kickAllAttendeesInRoomWithReason('A critical problem was detected. Please try again later.', id);
          }

          if (status === BoxWorkerStatus.STARTED) {
            return this.convertCandidates();
          }

          return of(undefined);
        }),
      ),
      this.voiceGateway.requestEvent<VoiceGatewayRequest>(VoiceGatewayEventType.REQUEST).pipe(
        filter(({status}) => !status),
        map(data => ({...data, aid: this.normalizeAttendeeId(data.aid, data.callsid)})),
        mergeMap(candidate => {
          const {callsid, aid, status} = candidate;

          if (!this.isValidateRequest(!!status, aid, callsid)) {
            return of(undefined);
          }

          this.inst.logger.debug(`negative request(${callsid}) is made, aid(${aid})`);

          this.candidateItems.delete(callsid);
          this.movePhonesInProgress.delete(callsid);

          return defer(() => {
            const attendee = this.getAssociatedAttendee(aid);
            if (!!attendee?.phoneAudio) {
              return this.detachPhone(attendee.id);
            }
            return of(undefined);
          }).pipe(
            tap(() => {
              this.toggleWorkerInRooms([this.getAssociatedRoom(aid).id]);
            })
          );
        }),
      ),
      this.voiceGateway.requestEvent<VoiceGatewayJoin>(VoiceGatewayEventType.JOIN).pipe(
        delay(300), // @todo it seems Twilio needs some time before be able to accept any commands
        filter(cid => {
          return !!this.movePhonesInProgress.has(cid);
        }),
        map(cid => {
          const item = this.movePhonesInProgress.get(cid);

          this.inst.logger.debug(`join request is made, moveInProgress(${item.aid})`);

          this.movePhonesInProgress.delete(cid);

          return item;
        }),
        mergeMap(({aid, fromRid, ssrInProgress}) => {
          const attendee = this.getAssociatedAttendee(aid);

          return this.attachPhonePipe(attendee.phoneAudio, attendee.room, fromRid, ssrInProgress);
        })
      ),
      merge(
        this.voiceGateway.requestEvent<VoiceGatewayJoin>(VoiceGatewayEventType.JOIN).pipe(
          delay(300), // @todo it seems Twilio need some time before be able to accept any commands
          filter(cid => {
            return !!this.candidateItems.has(cid);
          }),
          tap(cid => {
            const candidate = this.candidateItems.get(cid);

            this.inst.logger.debug(`Candidate ${cid} join in session`);

            this.candidateItems.set(cid, {...candidate, active: true});
          })
        ),
        this.voiceGateway.requestEvent<VoiceGatewayRequest>(VoiceGatewayEventType.REQUEST).pipe(
          filter(({status}) => !!status),
          map(data => ({...data, aid: this.normalizeAttendeeId(data.aid, data.callsid)})),
          filter(({status, aid, callsid}) => this.isValidateRequest(!!status, aid, callsid)),
          mergeMap(candidate => {
            const {callsid, uid, aid} = candidate;

            this.inst.logger.debug(`Candidate ${callsid}/${aid}/${uid} make a positive request`);

            const item: VoiceCandidateItem = {candidate, active: false};
            this.candidateItems.set(callsid, item);

            return defer(() => {
              if (uid) {
                return from(this.inst.fetchAttendeeInfo(aid));
              }
              return of({id: aid});
            }).pipe(
              tap(data => {
                const candidateItem = this.candidateItems.get(callsid);

                this.inst.logger.debug(`receive candidate(${callsid}) data`, data);

                if (candidateItem) {
                  this.inst.logger.debug(`set candidate(${callsid}) data`);
                  this.candidateItems.set(callsid, {...candidateItem, data});
                }
              }),
              map(() => callsid),
              takeUntil(this.voiceGateway.requestEvent<VoiceGatewayRequest>(VoiceGatewayEventType.REQUEST).pipe(
                filter(({callsid: cs, status: st}) => cs === callsid && !st)
              )),
              catchError(err => {
                this.inst.logger.error(`phone candidate(${callsid}) data fetching is failed`,  {aid, callsid});
                apm.captureError('fail: phone attendee data fetching', {
                  custom: {aid, callsid}
                });

                this.voiceGateway.kickPhone(callsid, 'A critical problem was detected. Please try again later.');

                return of(undefined);
              })
            );
          }),
        )
      ).pipe(
        mergeMap(callSid => {
          if (!callSid) {
            return of(undefined);
          }

          const {candidate: {aid}, data, active} = this.candidateItems.get(callSid);

          return defer(() => {
            if (this.hasToConvertCandidate(aid, data, active)) {
              return this.convertCandidate(callSid, aid, data, active);
            }
            return of(undefined);
          }).pipe(
            tap(() => {
              this.toggleWorkerInRooms([this.getAssociatedRoom(aid)?.id]);
            })
          );
        }),
      ),
    ).pipe(
      catchError(error => {
        this.inst.logger.error(error);
        apm.captureError(error);
        return EMPTY;
      }),
      takeUntil(this.destroyed$),
    );
  }

  private shouldMakeCallMe({target, requester}) {
    if (!target || !requester) {
      return false;
    }

    if (target.phoneAudio) {
      return false;
    }

    // if requester does not call him self or requester does not have permissions
    if (!requester.hasBaton && requester.id !== target.id) {
      return false;
    }

    if (this.callMeRequests.has(target.id) || this.callMeInProgress.has(target.id)) {
      return false;
    }

    return true;
  }

  private shouldMute(attendee: Attendee): boolean {
    return !this.inst.roomEngine.hasAnyPresenter || attendee.micState === MicState.denied || attendee.isAway;
  }

  private kickAllAttendeesInRoomWithReason(reason: string, rid?: Room['id']) {
    const ids: CallSid[] = [];

    const attendees = (
      rid === undefined ? this.inst.attendeeStorage.getAttendees() : this.inst.attendeeStorage.getAttendeeMapByRoomId(rid)
    );

    for (const [, attendee] of attendees) {
      if (attendee.phoneAudio) {
        ids.push(attendee.phoneAudio);
      }
    }
    this.candidateItems.forEach(({candidate: {aid}}, callSid) => {
      const attendee = this.getAssociatedAttendee(aid);

      if (rid === undefined || !attendee || attendee.room === rid) {
        ids.push(callSid);
      }
    });
    this.callMeInProgress.forEach(({callSid}, res) => {
      const attendee = this.getAssociatedAttendee(res);

      if (rid === undefined || !attendee || attendee.room === rid) {
        ids.push(callSid);
      }
    });

    this.inst.logger.debug(`Kill all phones in room(${rid}) because ${reason}`, ids);

    return this.voiceGateway.kickPhone(ids, reason);
  }

  private onPhoneSpeaking({aid, callSid: cid, speaking}: VoiceSpeaking) {
    const attendee = this.getAssociatedAttendee(this.normalizeAttendeeId(aid, cid));

    if (!attendee) {
      return;
    }

    if (attendee.micState !== MicState.denied && !attendee.left && attendee.phoneAudio) {
      this.inst.updateEngine.updateAttendee(null, attendee.id, { micState: (+speaking ? MicState.talking : MicState.normal) }, true);
    }
  }

  private toggleWorkerInRooms(rids?: Room['id'][]) {
    this.inst.logger.debug(`check worker in rooms`, rids);

    if (!rids) {
      rids = [];
      for (const rid in this.inst.model.roomsIndex) {
        rids.push(rid);
      }
    }

    const roomsWithCandidates = this.getCandidateAssociatedRooms();

    for (const rid of rids) {
      const anyInRoom = this.hasAnyPhoneInRoom(rid) || roomsWithCandidates.has(rid);
      const worker = this.getWorker(rid);

      this.inst.logger.debug(`has any(${anyInRoom}) in room(${rid}) and worker with status(${worker?.getCurrentStatus()})`);

      if (!anyInRoom && worker && worker.getCurrentStatus() !== BoxWorkerStatus.STOP) {
        this.stopWorker(worker.id);
        continue;
      }

      if (anyInRoom && (!worker || worker.getCurrentStatus() === BoxWorkerStatus.STOP)) {
        this.startWorker(rid);
      }
    }
  }

  private getCandidateAssociatedRooms(): Set<Room['id']> {
    const roomsWithCandidates = new Set<Room['id']>();
    this.candidateItems.forEach(({candidate: {aid}, active}) => {
      if (active) {
        roomsWithCandidates.add(this.getAssociatedRoom(aid).id);
      }
    });
    return roomsWithCandidates;
  }

  private convertCandidates() {
    const array: Observable<void>[] = [ ];

    this.candidateItems.forEach(({candidate: {aid}, data, active}, callSid) => {
      if (this.hasToConvertCandidate(aid, data, active)) {
        array.push(this.convertCandidate(callSid, aid, data, active));
      }
    });

    return forkJoin(array);
  }

  private convertCandidate(callSid: CallSid, aid: Attendee['id'], data: Partial<Attendee>, active: boolean): Observable<void> {
    return defer<void>(() => {
      this.inst.logger.debug(`convert candidate aid(${aid}), callSid(${callSid}), active(${active}), data(${!!data})`);

      this.candidateItems.delete(callSid);

      return this.attachPhone(aid, callSid, data);
    });
  }

  private hasToConvertCandidate(aid: Attendee['id'], data: Partial<Attendee>, active: boolean): boolean {
    this.inst.logger.debug(`Check candidate aid(${aid}), data(${!!data}), active(${active})`);
    // is still not joined from provider
    if (!active) {
      return false;
    }

    const room = this.getAssociatedRoom(aid);
    const worker = this.getWorker(room.id);

    // worker is still not started
    if (worker?.getCurrentStatus() !== BoxWorkerStatus.STARTED) {
      this.inst.logger.debug(`worker in room (${room.id}) is still in not good state (${worker?.getCurrentStatus()})`);
      return false;
    }

    if (!data) {
      return false;
    }

    return true;
  }

  private attachPhone(aid: Attendee['id'], callSid: CallSid, relatedData: Partial<Attendee>): Observable<void> {
    const attendee = this.getAssociatedAttendee(aid)

    this.inst.logger.info(`attach phone(${callSid}) to ${attendee ? 'new' : ''} attendee(${aid})`);

    if (attendee) {
      return from(this.inst.updateEngine.updateAttendee(null, attendee.id, {
        phoneAudio: callSid,
      }));
    } else {
      return from(this.inst.setupNewUser({
        ...relatedData,
        role: Roles.PHONE,
        firstName: this.normalizeFirstName(aid, relatedData.firstName),
        lastName: this.normalizeLastName(aid, relatedData.lastName),
        staticRole: this.normalizeLastRole(aid, relatedData.role),
        userAccountID: relatedData.userAccountID || callSid,
        phoneAudio: callSid,
        micState: MicState.normal,
      }));
    }
  }

  private detachPhone(aid: Attendee['id']): Observable<void> {
    const attendee = this.getAssociatedAttendee(aid);
    if (!attendee) {
      this.inst.logger.debug(`detach phone fails because attendee(${aid}) is missing`);
      apm.captureError('detach phone fails because associated attendee is missing', {custom: {aid}});
      return NEVER;
    }

    this.inst.logger.info(`detach phone(${attendee.phoneAudio}) from attendee(${aid})`);

    return from(this.inst.updateEngine.updateAttendee(null, attendee.id, {
      phoneAudio: '',
    }));
  }

  private getAssociatedAttendee(aid: Attendee['id']): Attendee | null {
    return this.inst.attendeeStorage.getAttendeeById(aid);
  }

  private getAssociatedRoom(aid: Attendee['id']): Room {
    const attendee = this.inst.attendeeStorage.getAttendeeById(aid);
    return this.inst.model.roomsIndex[attendee?.room || ''];
  }

  private startWorker(rid: Room['id']) {
    const worker = this.createWorker({id: rid});

    this.inst.logger.debug(`worker(${rid}) starting`);

    if (!worker.hasJob()) {
      this.inst.logger.debug(`worker(${rid}) start`);
      worker.start();

    }

    return worker;
  }

  private stopWorker(rid: Room['id'], preserveState = false): void {
    // preserve=true is used for pausing worker to keep worker state
    const worker = this.getWorker(rid);
    const reason = preserveState ? BoxWorkerStatus.PAUSE : BoxWorkerStatus.STOP;

    this.inst.logger.debug(`worker(${rid}) stopping because(${reason})`);

    if (worker) {
      this.inst.logger.debug(`worker(${rid}) stop because(${reason})`);
      worker.stop(reason);
    }
  }

  private createWorker(payload: BoxWorkerBasePayload, status?: BoxWorkerStatus): BoxWorker {
    const currentWorker = this.getWorker(payload.id);

    if (currentWorker) {
      this.inst.logger.debug(`worker(${currentWorker.id}) is re-delivered`);
      return currentWorker;
    }

    this.inst.logger.debug(`worker(${payload.id}) is creating`);

    const worker = new VoiceWorker(payload, this.inst, status);
    this.workerStore.set(payload.id, {
      worker,
      subscriptions: worker.state$.pipe(
        tap(state => this.workerChangeState$.next({id: worker.id, state})),
        takeWhile(state => {
          return state.status !== BoxWorkerStatus.STOP;
        }),
        takeUntil(this.destroyed$),
        finalize(() => {
          this.inst.logger.debug(`worker(${worker.id}) is successfully finalized and removed`);
          this.workerStore.delete(worker.id);
        })
      ).subscribe()
    });

    return worker;
  }

  private getWorker(id: BoxWorkerBasePayload['id']): BoxWorker | undefined {
    return this.workerStore.get(id)?.worker;
  }

  protected populateState({workers}: BoxWorkerMongodbSchema): void {
    // for (const payload of workers) {
    //   this.createWorker(payload, BoxWorkerStatus.PAUSE);
    // }

    // @todo do nothing
    // @todo the other option is check the rooms with phones like ask Twilio, and start workers for each
  }

  protected serializeState(): BoxWorkerMongodbSchema | null {
    // const workers: BoxWorkerBasePayload[] = [];

    // this.workerStore.forEach(({worker}) => {
    //   if (worker.getState().status !== BoxWorkerStatus.STOP) {
    //     workers.push(worker.payload);
    //   }
    // });

    // return workers.length ? {workers} : null;

    // @todo kick out all phones! very rude but avoid тхе issue: while the server restarts the phone to exit
    // @todo the other option is do nothing here but doing harder in populateState

    return null;
  }

  private isCallMeRequest(status: boolean, aid: Attendee['id'], callSid: CallSid): boolean {
    if (this.callMeInProgress.has(aid)) {
      const {req} = this.callMeInProgress.get(aid);
      this.inst.logger.debug(`detect call me request, callSid${callSid}, status(${status}), req${req}`);

      this.callMeInProgress.delete(aid);

      if (!status) {
        // @todo  send some useful information to the requester
        this.inst.sendToAttendee(req, ClientConnectionAPI.PHONE_CALL_ME, null);

        return true;
      }
    }
    return false;
  }

  /**
   * Sometimes if in short time start and end are requested there has a case they to come in bad order or end before start
   * or the other case is stop is coming but start did not come at all.
   */
  private isPhantomRequest(status: boolean, aid: Attendee['id'], callSid: CallSid): boolean {
    if (status) {
      if (this.phantoms.has(callSid)) {
        const timeReq = this.phantoms.get(callSid);
        this.phantoms.delete(callSid);

        // in case start is not came at all, so check if end was registered in last 10 secs
        const isGoodTime = (timeReq + 10000) > Date.now();

        this.inst.logger.debug(`delete phantom, callSid(${callSid}), aid${aid}, isGoodTime(${isGoodTime})`);

        return isGoodTime;
      }
    } else {
      const attendee = this.inst.attendeeStorage.getAttendeeById(aid);
      if (attendee?.phoneAudio === callSid) {
        return false;
      }

      if (this.candidateItems.has(callSid)) {
        return false;
      }

      this.inst.logger.debug(`set phantom, callSid(${callSid}), aid(${aid})`);

      this.phantoms.set(callSid, Date.now());
      return true;
    }

    return false;
  }

  private isValidateRequest(status: boolean, aid: Attendee['id'], callSid: CallSid): boolean {
    if (this.isCallMeRequest(status, aid, callSid)) {
      return false;
    }

    if (this.isPhantomRequest(status, aid, callSid)) {
      return false;
    }

    return true;
  }

  // @fixme change core api to standardized input parameters
  private normalizeAttendeeId(aid: Attendee['id'] | '0' | 'false', callSid: string): Attendee['id'] | string {
    const _aid = aid.toString();

    if (_aid === '' || _aid === '0' || _aid === 'false') {
      return callSid;
    }

    return _aid;
  }

  private normalizeFirstName(aid: Attendee['id'], name: Attendee['firstName']): Attendee['firstName'] | string {
    const attendee = this.inst.attendeeStorage.getAttendeeById(aid);

    VoiceModule.anonymousId++;

    return attendee ? attendee.firstName : (name || `PhoneUser#${VoiceModule.anonymousId}`);
  }

  private normalizeLastName(aid: Attendee['id'], name: Attendee['lastName']): Attendee['lastName'] | string {
    const attendee = this.inst.attendeeStorage.getAttendeeById(aid);

    return attendee ? attendee.lastName : (name || '');
  }

  private normalizeLastRole(aid: Attendee['id'], role: Attendee['role']): Roles {
    const attendee = this.inst.attendeeStorage.getAttendeeById(aid);

    return attendee ? attendee.role : (role || Roles.PHONE);
  }

  // @todo too much work here. Need to be optimized
  private hasAnyPhoneInRoom(rid: Room['id']): boolean {
    for (const [, attendee] of this.inst.attendeeStorage.getAttendeeMapByRoomId(rid)) {
      if (attendee.phoneAudio && !attendee.left) {
        return true;
      }
    }
    return false;
  }

  /**
   * How it works:
   *    First check if enableRecordingNotification is enabled and then decide to send message before to send mute command
   */
  private attachPhonePipe(callSids: callSid | callSid[], targetRid: Room['id'], fromRid?: Room['id'], ssrInProgress?: boolean) {
    let _cids: callSid[];

    if (typeof callSids === 'string') {
      _cids = [callSids];
    } else {
      _cids = callSids;
    }

    if (!_cids.length) {
      return of(undefined);
    }

    if (!this.enableRecordingNotification) {
      return this.changeAudioState(callSids);
    }

    const targetRoom = this.inst.roomEngine.getRoomById(targetRid);
    const fromRoom = this.inst.roomEngine.getRoomById(fromRid);

    const hasTargetRoomSSR = this.roomsSSRState.get(targetRid);
    const hasFromRoomSSR = this.roomsSSRState.get(fromRid) || ssrInProgress;

    if ((hasFromRoomSSR || targetRoom.id === fromRoom?.id) && !hasTargetRoomSSR) {
      return this.voiceGateway.announcePhone(callSids, targetRid, 'Recording has ended.').pipe(
        switchMap(() => this.afterSendRecordMessagePipe(_cids))
      );
    }

    if ((!hasFromRoomSSR || targetRoom.id === fromRoom.id) && hasTargetRoomSSR) {
      return this.voiceGateway.announcePhone(callSids, targetRid, 'The Session is being recorded. If you prefer not to be recorded, please exit the session now.').pipe(
        switchMap(() => this.afterSendRecordMessagePipe(_cids))
      );
    }

    return this.changeAudioState(callSids);
  }

  private afterSendRecordMessagePipe(callSids: CallSid[]) {
    const cidsSet = new Set(callSids);

    return merge(
      timer(this.afterSendRecordMessageTimeout * 1000),
      this.voiceGateway.requestEvent<VoiceGatewayJoin>(VoiceGatewayEventType.JOIN).pipe(
        mergeMap(callsid => {
          if (cidsSet.has(callsid)) {
            cidsSet.delete(callsid);

            return this.changeAudioState([callsid]);
          }
          return of(undefined);
        }),
        filter(() => cidsSet.size === 0),
      )
    ).pipe(
      take(1)
    );
  }

  private changeAudioState(callSids: CallSid | CallSid[]) {
    if (!this.inst.roomEngine.hasAnyPresenter) {
      return this.voiceGateway.holdPhone(callSids, 'Please wait for the presenter to join the session.');
    } else {
      if (typeof callSids === 'string') {
        callSids = [callSids];
      }
      
      const muteList = [];
      for(const callSid of callSids) {
        const attendee = this.inst.attendeeStorage.getAttendeeByPhoneAudio(callSid);

        if (this.shouldMute(attendee)) {
          muteList.push(callSid);
        }
      }

      if (muteList.length) {
        return this.voiceGateway.mutePhone(muteList, true);
      } else {
        return of(null);
      }
    }
  }
}
