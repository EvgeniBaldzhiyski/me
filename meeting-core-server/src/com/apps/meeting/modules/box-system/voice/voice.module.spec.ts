import { createModule, MockMeeting, MockUpdateEngine } from '../../_TEST_/meeting-mocks.lib';

import { Observable, of, Subject, merge } from 'rxjs';
import { Attendee, BoxWorkerStatus, ClientConnectionAPI, ErrorCodes, MicState, Model, Roles, Room, SessionAudio } from '@container/models';

class MockVoiceWorker {
  __status = BoxWorkerStatus.STOP;

  id = 'test-worker-id';

  state$ = new Subject;

  constructor(payload) {
    this.id = payload.id;
  }

  start() {}
  stop() {
    this.__status = BoxWorkerStatus.STOP;
    this.state$.next({id: this.id, status: BoxWorkerStatus.STOP});
  }
  hasJob() {
    return false;
  }
  getState() {
    return {id: this.id, status: this.__status};
  }
  getCurrentStatus() {
    return this.getState().status;
  }
}

class VoiceGatewayMock {
  holdPhone() {
    return of({});
  }
  mutePhone() {
    return of({});
  }
  movePhone() {
    return of({});
  }
  kickPhone() {
    return of({ });
  }
  callMe() {
    return of({});
  }
  requestEvent(type): Observable<unknown> {
   return new Subject;
  }
}

jest.mock('./voice.gateway', () => {
  return {
    __esModule: true,
    VoiceGateway: VoiceGatewayMock
  };
});

jest.mock('./voice.worker', () => {
  return {
    __esModule: true,
    VoiceWorker: MockVoiceWorker
  };
});

import VoiceModule from './voice.module';
import { VoiceGatewayEventType } from './voice.interfaces';
import { delay, ignoreElements, map, take, tap } from 'rxjs/operators';
import { NoMainPresenterEvent, NoMainPresenterTimeoutEvent, SessionEventTypes } from '../../../events/SessionEvents';
import { BoxWorkerBasePayload } from '../utils/workers/box.worker.interface';

describe('development', () => {
  let module;
  let workData;
  let workingModel;

  beforeEach(() => {
    workingModel = {
      ...new Model(),
      meetingID: 'meeting-id',
      meetingRunID: 'meeting-run-id',
      roomsIndex: {
        '': new Room({id: ''}),
        'room-id': new Room({id: 'room-id'})
      }
    };

    workData = {...workingModel};
  });

  afterEach(async () => {
    await module.beforeDestruct();
    await module.destruct();

    jest.clearAllMocks();
  });

  describe('Basic tests', () => {
    it('Module setup', async () => {
      const bindEventsSpy = jest.spyOn(VoiceModule.prototype as any, 'bindModuleEvents');

      module = createModule(VoiceModule);

      await module.setup();

      expect(bindEventsSpy).toHaveBeenCalled();
    });

    it('Module destruct (session gracefully shutdown)', async () => {
      const kickAllAttendeesInRoomWithReasonSpy = jest.spyOn(
        VoiceModule.prototype as any, 'kickAllAttendeesInRoomWithReason'
      );
      const kickPhonesSpy = jest.spyOn(VoiceGatewayMock.prototype, 'kickPhone');
      const updateAttendeeSpy = jest.spyOn(MockUpdateEngine.prototype, 'approveAndApplyData');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.beforeDestruct(ErrorCodes.SERVER_RESTART);

      expect(kickAllAttendeesInRoomWithReasonSpy).toBeCalled();
      expect(updateAttendeeSpy).toBeCalledWith(null, {id: 'attendee-1', data: {phoneAudio: ''}});
      expect(kickPhonesSpy).toBeCalledWith(['attendee-1-phone-audio'], expect.any(String));
    });
  });

  describe('bind events', () => {
    describe('VoiceGatewayEventType.DIAL_OUT', () => {
      it('Ok', async () => {
        jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
          if (type !== VoiceGatewayEventType.DIAL_OUT) {
            return new Subject;
          }

          return of(true).pipe(
            delay(1),
            map(() => ({ aid: 'attendee-1' })),
          );
        });

        const spy = jest.spyOn(VoiceGatewayMock.prototype, 'kickPhone');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.inst.attendeeStorage.addAttendee({
          id: 'attendee-1',
          room: '',
          phoneAudio: 'attendee-1-phone-audio',
          left: false,
          role: Roles.ATTENDEE,
          micState: MicState.normal
        });

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spy).toBeCalledWith('attendee-1-phone-audio');
      });
    });

    describe('VoiceGatewayEventType.SPEAKING', () => {
      let spy;

      beforeEach(() => {
        jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
          if (type !== VoiceGatewayEventType.SPEAKING) {
            return new Subject;
          }

          return of(true).pipe(
            delay(1),
            map(() => ({
              aid: 'attendee-1',
              callSid: 'attendee-1-phone-audio',
              speaking: '1'
            })),
          );
        });

        spy = jest.spyOn(MockUpdateEngine.prototype, 'updateAttendee');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.inst.attendeeStorage.addAttendee({
          id: 'attendee-1',
          room: '',
          phoneAudio: 'attendee-1-phone-audio',
          left: false,
          role: Roles.ATTENDEE,
          micState: MicState.normal
        });
      });

      it('Ok', async () => {
        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spy).toBeCalledWith(null, 'attendee-1', { micState: MicState.talking}, true);
      });

      it('Fail(mic is denied)', async () => {
        module.inst.model.attendeesIndex['attendee-1'].micState = MicState.denied;

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spy).not.toBeCalled();
      });

      it('Fail(attendee left)', async () => {
        module.inst.model.attendeesIndex['attendee-1'].left = true;

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spy).not.toBeCalled();
      });

      it('Fail(attendee is missing)', async () => {
        module.inst.attendeeStorage.removeAttendee('attendee-1');

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spy).not.toBeCalled();
      });
    });

    describe('SessionEventTypes.ROOM_BEFORE_CLOSE', () => {
      it('Ok', async () => {
        jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => new Subject);

        const spy = jest.spyOn(MockVoiceWorker.prototype, 'stop');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};

        module.createWorker({id: ''} as BoxWorkerBasePayload);

        await merge(
          module.bindModuleEvents(),
          of(true).pipe(
            delay(1),
            tap(() => {
              module.inst.eventBus.emit(SessionEventTypes.ROOM_BEFORE_CLOSE, '');
            }),
            ignoreElements()
          )
        ).pipe(take(1)).toPromise();

        expect(spy).toBeCalledWith(BoxWorkerStatus.STOP);
      });
    });

    describe('VoiceGatewayEventType.CALL_ME', () => {
      beforeEach(() => {
        jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
          if (type !== VoiceGatewayEventType.CALL_ME) {
            return new Subject;
          }

          return of(true).pipe(
            delay(1),
            map(() => ({
              reqOwner: 'attendee-1',
              aid: 'attendee-1',
              extension: '',
              code: '+359',
              phone: '555-555-5555'
            })),
          );
        });
      });

      it('Ok', async () => {
        const spyCallMe = jest.spyOn(VoiceGatewayMock.prototype, 'callMe').mockImplementation(() => {
          return of({status: 200, data: {sid: 'attendee-1-sud', number: '000-000-0000'}});
        });
        const spySend = jest.spyOn(MockMeeting.prototype, 'sendToAttendee');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.inst.attendeeStorage.addAttendee({
          id: 'attendee-1',
          room: '',
          phoneAudio: '',
          left: false,
          role: Roles.ATTENDEE,
          micState: MicState.normal
        });

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spyCallMe).toBeCalledWith('', '+359', '555-555-5555', expect.objectContaining({id: 'attendee-1'}));
        expect(spySend).toBeCalledWith('attendee-1', ClientConnectionAPI.PHONE_CALL_ME, expect.objectContaining({ code: 200, message: '000-000-0000'}));
        expect(module.callMeRequests.size).toBe(0);
        expect(module.callMeInProgress.get('attendee-1')).toMatchObject({req: 'attendee-1', callSid: 'attendee-1-sud'});

        jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
          if (type !== VoiceGatewayEventType.REQUEST) {
            return new Subject;
          }

          return of(true).pipe(
            delay(1),
            map(() => ({
              status: 1,
              aid: 'attendee-1',
              callsid: 'attendee-1-sud'
            })),
          );
        });

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(module.callMeInProgress.get('attendee-1')).toBeFalsy();
      });

      it('Fail(attendee is missing)', async () => {
        const spyCallMe = jest.spyOn(VoiceGatewayMock.prototype, 'callMe');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        delete module.inst.model.attendeesIndex['attendee-1'];

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spyCallMe).not.toBeCalled();
      });

      it('Fail(attendee has attach phone)', async () => {
        const spyCallMe = jest.spyOn(VoiceGatewayMock.prototype, 'callMe');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spyCallMe).not.toBeCalled();
      });

      it('Fail(request in progress)', async () => {
        const spyCallMe = jest.spyOn(VoiceGatewayMock.prototype, 'callMe');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.callMeRequests.add('attendee-1');

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(spyCallMe).not.toBeCalled();
      });

      it('Fail(call me in progress)', async () => {
        const spyCallMe = jest.spyOn(VoiceGatewayMock.prototype, 'callMe');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.callMeInProgress.set('attendee-1');

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        module.callMeInProgress.delete('attendee-1');

        expect(spyCallMe).not.toBeCalled();
      });

      it('Fail(call is rejected)', async () => {
        const spyCallMe = jest.spyOn(VoiceGatewayMock.prototype, 'callMe').mockImplementation(() => {
          return of({status: -200, data: {error: '{{TEST_ERROR}}'}});
        });
        const spySend = jest.spyOn(MockMeeting.prototype, 'sendToAttendee');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.inst.attendeeStorage.addAttendee({
          id: 'attendee-1',
          room: '',
          phoneAudio: '',
          left: false,
          role: Roles.ATTENDEE,
          micState: MicState.normal
        });

        await module.bindModuleEvents().pipe(take(1)).toPromise();

        expect(module.callMeRequests.size).toBe(0);
        expect(module.callMeInProgress.size).toBe(0);
        expect(spySend).toBeCalledWith('attendee-1', ClientConnectionAPI.PHONE_CALL_ME, expect.objectContaining({ code: -200, message: '{{TEST_ERROR}}'}));
      });
    });
  });

  describe('NoMainPresenterTimeoutEvent', () => {
    it('Ok', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => new Subject);

      const spy = jest.spyOn(VoiceGatewayMock.prototype, 'kickPhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      module.createWorker({id: ''} as BoxWorkerBasePayload);

      await merge(
        module.bindModuleEvents(),
        of(true).pipe(
          delay(1),
          tap(() => {
            module.inst.eventBus.emit(NoMainPresenterTimeoutEvent.type, 'test-message');
          }),
          ignoreElements()
        )
      ).pipe(take(1)).toPromise();

      expect(spy).toBeCalledWith(['attendee-1-phone-audio'], 'test-message');
    });
  });

  describe('NoMainPresenterEvent', () => {
    jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => new Subject);

    const spyHold = jest.spyOn(VoiceGatewayMock.prototype, 'holdPhone');
    const spyMute = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

    const emitEvent = (value) => {
      return of(true).pipe(
        delay(1),
        tap(() => {
          module.inst.eventBus.emit(NoMainPresenterEvent.type, value);
        }),
        ignoreElements()
      );
    };

    beforeEach(() => {
      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      module.createWorker({id: ''} as BoxWorkerBasePayload);
    });

    it('Ok(presenter is out)', async () => {
      await merge(
        module.bindModuleEvents(),
        emitEvent(true)
      ).pipe(take(1)).toPromise();

      expect(spyHold).toBeCalledWith(['attendee-1-phone-audio'], expect.any(String));
    });

    it('Ok(presenter is coming)', async () => {
      await merge(
        module.bindModuleEvents(),
        emitEvent(false)
      ).pipe(take(1)).toPromise();

      expect(spyHold).toBeCalledWith(['attendee-1-phone-audio']);
      expect(spyMute).toBeCalledWith([], true);

      module.inst.model.attendeesIndex['attendee-1'].micState = MicState.denied;

      await merge(
        module.bindModuleEvents(),
        emitEvent(false)
      ).pipe(take(1)).toPromise();

      expect(spyMute).toBeCalledWith(['attendee-1-phone-audio'], true);
    });

    it('Fail(no attendee with attach phone)', async () => {
      module.inst.model.attendeesIndex['attendee-1'].phoneAudio = '';

      await merge(
        module.bindModuleEvents(),
        emitEvent(true)
      ).pipe(take(1)).toPromise();

      expect(spyHold).not.toBeCalled();
      expect(spyMute).not.toBeCalled();
    });
  });

  describe('SessionEventTypes.REFRESH_SETTINGS', () => {
    it('Ok', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => new Subject);

      const spy = jest.spyOn(VoiceGatewayMock.prototype, 'kickPhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });
      module.inst.model.sessionSettings.audio[0] = SessionAudio.COMPUTER_ONLY;

      await merge(
        module.bindModuleEvents(),
        of(true).pipe(
          delay(1),
          tap(() => {
            module.inst.eventBus.emit(SessionEventTypes.REFRESH_SETTINGS);
          }),
          ignoreElements()
        )
      ).pipe(take(1)).toPromise();

      expect(spy).toBeCalledWith(['attendee-1-phone-audio'], expect.any(String));
    });
  });

  describe('workerChangeState', () => {
    const emitEvent = (status) => {
      return of(true).pipe(
        delay(1),
        tap(() => {
          module.workerChangeState$.next({id: '', state: {status}});
        }),
        ignoreElements()
      );
    };

    describe('Worker start', () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => new Subject);

      const spyUpdate = jest.spyOn(MockUpdateEngine.prototype, 'updateAttendee');
      const spyNew = jest.spyOn(MockMeeting.prototype, 'setupNewUser');

      it('Ok', async () => {
        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.inst.attendeeStorage.addAttendee({
          id: 'attendee-1',
          room: '',
          phoneAudio: '',
          left: false,
          role: Roles.ATTENDEE,
          micState: MicState.normal
        });

        const worker = module.createWorker({id: ''} as BoxWorkerBasePayload);
        worker.__status = BoxWorkerStatus.STARTED;

        module.candidateItems.set('attendee-1-phone-audio', {candidate: {aid: 'attendee-1'}, data: {id: 'attendee-1'}, active: true});
        module.candidateItems.set('attendee-2-phone-audio', {candidate: {aid: ''}, data: {id: 'attendee-2-phone-audio'}, active: true});

        await merge(
          module.bindModuleEvents(),
          emitEvent(BoxWorkerStatus.STARTED)
        ).pipe(take(1)).toPromise();

        expect(spyUpdate).toBeCalledWith(null, 'attendee-1', {
          phoneAudio: 'attendee-1-phone-audio',
        });
        expect(spyNew).toBeCalledWith(expect.objectContaining({id: 'attendee-2-phone-audio'}));
      });

      it('no active candidate', async () => {
        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.inst.attendeeStorage.addAttendee({
          id: 'attendee-1',
          room: '',
          phoneAudio: '',
          left: false,
          role: Roles.ATTENDEE,
          micState: MicState.normal
        })

        const worker = module.createWorker({id: ''} as BoxWorkerBasePayload);
        worker.__status = BoxWorkerStatus.STARTED;

        module.candidateItems.set('attendee-1-phone-audio', {candidate: {aid: 'attendee-1'}, data: {id: 'attendee-1'}, active: false});
        module.candidateItems.set('attendee-2-phone-audio', {candidate: {aid: ''}, data: {id: 'attendee-2-phone-audio'}, active: true});

        await merge(
          module.bindModuleEvents(),
          emitEvent(BoxWorkerStatus.STARTED)
        ).pipe(take(1)).toPromise();

        expect(spyUpdate).not.toBeCalledWith(null, 'attendee-1', {
          phoneAudio: 'attendee-1-phone-audio',
        });
      });

      it('no candidate with data', async () => {
        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.inst.attendeeStorage.addAttendee({
          id: 'attendee-1',
          room: '',
          phoneAudio: '',
          left: false,
          role: Roles.ATTENDEE,
          micState: MicState.normal
        })

        const worker = module.createWorker({id: ''} as BoxWorkerBasePayload);
        worker.__status = BoxWorkerStatus.STARTED;

        module.candidateItems.set('attendee-1-phone-audio', {candidate: {aid: 'attendee-1'}, data: null, active: false});
        module.candidateItems.set('attendee-2-phone-audio', {candidate: {aid: ''}, data: {id: 'attendee-2-phone-audio'}, active: true});

        await merge(
          module.bindModuleEvents(),
          emitEvent(BoxWorkerStatus.STARTED)
        ).pipe(take(1)).toPromise();

        expect(spyUpdate).not.toBeCalledWith(null, 'attendee-1', {
          phoneAudio: 'attendee-1-phone-audio',
        });
      });
    });

    describe('Worker stop', () => {
      it('Ok', async () => {
        jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => new Subject);

        const spy = jest.spyOn(VoiceGatewayMock.prototype, 'kickPhone');

        module = createModule(VoiceModule) as VoiceModule;
        module.inst.model = {...workData};
        module.inst.attendeeStorage.addAttendee({
          id: 'attendee-1',
          room: '',
          phoneAudio: 'attendee-1-phone-audio',
          left: false,
          role: Roles.ATTENDEE,
          micState: MicState.normal
        });
        module.createWorker({id: ''} as BoxWorkerBasePayload);

        await merge(
          module.bindModuleEvents(),
          emitEvent(BoxWorkerStatus.STOP)
        ).pipe(take(1)).toPromise();

        expect(spy).toBeCalledWith(['attendee-1-phone-audio'], expect.any(String));
      });
    });
  });

  describe('REQUEST(negative)', () => {
    it('Ok(candidate is available)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.REQUEST) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => ({
            status: 0,
            callsid: 'attendee-2-phone-audio',
            aid: 'attendee-2',
            uid: 'UID'
          })),
        );
      });

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      module.candidateItems.set('attendee-2-phone-audio', {candidate: {aid: 'attendee-2'}, data: {id: 'attendee-2'}, active: true});

      module.createWorker({id: ''} as BoxWorkerBasePayload);

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.candidateItems.size).toBe(0);
    });

    it('Ok(attach phone is available)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.REQUEST) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => ({
            status: 0,
            callsid: 'attendee-1-phone-audio',
            aid: 'attendee-1',
            uid: 'UID'
          })),
        );
      });

      const spyUpdate = jest.spyOn(MockUpdateEngine.prototype, 'updateAttendee');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      module.createWorker({id: ''} as BoxWorkerBasePayload);

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(spyUpdate).toBeCalledWith(null, 'attendee-1', {
        phoneAudio: '',
      });
    });

    it('Fail(there does not have any)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.REQUEST) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => ({
            status: 0,
            callsid: 'attendee-1-phone-audio',
            aid: 'attendee-1'
          })),
        );
      });

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: '',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      module.createWorker({id: ''} as BoxWorkerBasePayload);

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.phantoms.size).toBe(1);
    });
  });

  describe('VoiceGatewayEventType.JOIN', () => {
    it('Ok(mute after move)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.JOIN) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => 'attendee-1-phone-audio'),
        );
      });

      const spyMute = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.denied
      });
      module.movePhonesInProgress.set('attendee-1-phone-audio', {aid: 'attendee-1', fromRid: ''});

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.movePhonesInProgress.size).toBe(0);
      expect(spyMute).toBeCalledWith(['attendee-1-phone-audio'], true);
    });

    it('Ok(miss mute after move)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.JOIN) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => 'attendee-1-phone-audio'),
        );
      });

      const spyMute = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.movePhonesInProgress.set('attendee-1-phone-audio', 'attendee-1');

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.movePhonesInProgress.size).toBe(0);
      expect(spyMute).not.toBeCalled();
    });

    it('Ok(hold after move)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.JOIN) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => 'attendee-1-phone-audio'),
        );
      });

      const spyHold = jest.spyOn(VoiceGatewayMock.prototype, 'holdPhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.denied
      });
      module.movePhonesInProgress.set('attendee-1-phone-audio', {aid: 'attendee-1', fromRid: ''});
      module.inst.roomEngine.hasAnyPresenter = false;

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.movePhonesInProgress.size).toBe(0);
      expect(spyHold).toBeCalledWith('attendee-1-phone-audio', expect.any(String));
    });
  });

  describe('REQUEST(positive)', () => {
    it('Ok(for real account)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.REQUEST) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => ({
            status: 1,
            callsid: 'attendee-1-phone-audio',
            aid: 'attendee-1',
            uid: 'UID'
          })),
        );
      });

      const spyFetchInfo = jest.spyOn(MockMeeting.prototype, 'fetchAttendeeInfo');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.candidateItems.has('attendee-1-phone-audio')).toBeTruthy();
      expect(spyFetchInfo).toBeCalledWith('attendee-1');
    });

    it('Ok(for antonymous)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.REQUEST) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => ({
            status: 1,
            callsid: 'attendee-0-phone-audio',
            aid: '',
            uid: ''
          })),
        );
      });

      const spyFetchInfo = jest.spyOn(MockMeeting.prototype, 'fetchAttendeeInfo');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.candidateItems.has('attendee-0-phone-audio')).toBeTruthy();
      expect(spyFetchInfo).not.toBeCalled();
    });

    it('Ok(test working)', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type === VoiceGatewayEventType.REQUEST) {
          return of(true).pipe(
            delay(1),
            map(() => ({
              status: 1,
              callsid: 'attendee-0-phone-audio',
              aid: '',
              uid: ''
            })),
          );
        }
        return new Subject;
      });

      const spyWorkerStart = jest.spyOn(MockVoiceWorker.prototype, 'start');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.candidateItems.has('attendee-0-phone-audio')).toBeTruthy();
      expect(spyWorkerStart).toBeCalled();

      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type === VoiceGatewayEventType.JOIN) {
          return of(true).pipe(
            delay(1),
            map(() => 'attendee-0-phone-audio'),
          );
        }

        return new Subject;
      });

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.candidateItems.get('attendee-0-phone-audio').active).toBe(true);
    });

    it('Fail', async () => {
      jest.spyOn(VoiceGatewayMock.prototype, 'requestEvent').mockImplementation(type => {
        if (type !== VoiceGatewayEventType.REQUEST) {
          return new Subject;
        }

        return of(true).pipe(
          delay(1),
          map(() => ({
            status: 1,
            callsid: 'attendee-1-phone-audio',
            aid: 'attendee-1',
            uid: 'UID'
          })),
        );
      });

      jest.spyOn(MockMeeting.prototype, 'fetchAttendeeInfo').mockImplementation(() => {
        throw new Error('{{TEST_ERROR}}');
      });

      const kickPhoneSpy = jest.spyOn(VoiceGatewayMock.prototype, 'kickPhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.bindModuleEvents().pipe(take(1)).toPromise();

      expect(module.candidateItems.has('attendee-1-phone-audio')).toBeTruthy();
      expect(kickPhoneSpy).toBeCalledWith('attendee-1-phone-audio', expect.any(String));
    });
  });

  describe('approveAttendeeChange', () => {
    it('kickOut if phone is coming', async () => {
      const spy = jest.spyOn(VoiceGatewayMock.prototype, 'kickPhone');
      const controlSpy = jest.fn(() => Promise.resolve());

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: '',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });
      module.inst.attendeeStorage.updateAttendee('attendee-1', {kickedOut: 'any-reason',});

      await module.approveAttendeeChange(null, 'attendee-1', {phoneAudio: 'attendee-1-phone-audio'}, controlSpy);

      expect(spy).toBeCalledWith('attendee-1-phone-audio', expect.any(String));
      expect(controlSpy).toBeCalledWith(null);
    });

    it('attendee with attach phone left', async () => {
      const controlSpy = jest.fn(() => {
        return Promise.resolve();
      });

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.denied
      });

      await module.approveAttendeeChange(null, 'attendee-1', {left: true}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        isAway: false,
        left: false,
        role: Roles.PHONE
      }));
    });

    it('phone is coming if attendee is left', async () => {
      const controlSpy = jest.fn(() => {
        return Promise.resolve();
      });

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: '',
        left: true,
        role: Roles.ATTENDEE,
        micState: MicState.denied
      });

      await module.approveAttendeeChange(null, 'attendee-1', {phoneAudio: true}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        left: false,
        role: Roles.PHONE
      }));
    });

    it('phone is going out but there attendee is missing', async () => {
      const controlSpy = jest.fn(() => {
        return Promise.resolve();
      });

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: '',
        left: true,
        role: Roles.PHONE,
        micState: MicState.denied
      });

      await module.approveAttendeeChange(null, 'attendee-1', {phoneAudio: ''}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        left: true
      }));
    });

    it('move between room', async () => {
      const controlSpy = jest.fn(() => {
        return Promise.resolve();
      });

      const moveSpy = jest.spyOn(VoiceGatewayMock.prototype, 'movePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {room: 'room-id'}, controlSpy);

      expect(module.movePhonesInProgress.has('attendee-1-phone-audio')).toBeTruthy();
      expect(moveSpy).toBeCalledWith('attendee-1-phone-audio', 'room-id');
    });

    it('mute attendee with micState', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', {micState: data.micState});
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {micState: MicState.denied}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        micState: MicState.denied
      }));
      expect(muteSpy).toBeCalledWith('attendee-1-phone-audio', true);
    });

    it('unmute attendee with micState', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', {micState: data.micState});
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.denied
      });

      await module.approveAttendeeChange(null, 'attendee-1', {micState: MicState.talking}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        micState: MicState.talking
      }));
      expect(muteSpy).toBeCalledWith('attendee-1-phone-audio', false);
    });

    it('attendee sty mute because no presenter', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', {micState: data.micState});
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.denied
      });
      module.inst.roomEngine.hasAnyPresenter = false;

      await module.approveAttendeeChange(null, 'attendee-1', {micState: MicState.talking}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        micState: MicState.talking
      }));
      expect(muteSpy).toBeCalledWith('attendee-1-phone-audio', true);
    });

    it('going step away', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', {isAway: data.isAway});
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {isAway: true}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        isAway: true
      }));
      expect(muteSpy).toBeCalledWith('attendee-1-phone-audio', true);
    });

    it('return after step away', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', {isAway: data.isAway});
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {isAway: false}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        isAway: false
      }));
      expect(muteSpy).toBeCalledWith('attendee-1-phone-audio', false);
    });

    it('return after step away but no presenter', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', {isAway: data.isAway});
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });
      module.inst.roomEngine.hasAnyPresenter = false;

      await module.approveAttendeeChange(null, 'attendee-1', {isAway: false}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        isAway: false
      }));
      expect(muteSpy).not.toBeCalled();
    });

    it('attach phone to attendee in no main room', async () => {
      const controlSpy = jest.fn(data => {
        return Promise.resolve();
      });

      const moveSpy = jest.spyOn(VoiceGatewayMock.prototype, 'movePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: 'room-id',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {phoneAudio: 'attendee-1-phone-audio', attendeeAdded: true}, controlSpy);

      expect(module.movePhonesInProgress.has('attendee-1-phone-audio')).toBeTruthy();
      expect(moveSpy).toBeCalledWith('attendee-1-phone-audio', 'room-id');
    });

    it('attach phone to attendee in main room and mute because mic state', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', {phoneAudio: data.phoneAudio});
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: '',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.denied
      });

      await module.approveAttendeeChange(null, 'attendee-1', {phoneAudio: 'attendee-1-phone-audio'}, controlSpy);

      expect(module.movePhonesInProgress.has('attendee-1-phone-audio')).toBeFalsy();
      expect(muteSpy).toBeCalledWith(['attendee-1-phone-audio'], true);
    });

    it('attach phone to attendee in main room and mute because no presenter', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', {phoneAudio: data.phoneAudio});
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'holdPhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: '',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });
      module.inst.roomEngine.hasAnyPresenter = false;

      await module.approveAttendeeChange(null, 'attendee-1', {phoneAudio: 'attendee-1-phone-audio'}, controlSpy);

      expect(module.movePhonesInProgress.has('attendee-1-phone-audio')).toBeFalsy();
      expect(muteSpy).toBeCalledWith('attendee-1-phone-audio', 'Please wait for the presenter to join the session.');
    });

    it('attach phone to attendee in main room and not mute', async () => {
      const controlSpy = jest.fn(data => {
        return Promise.resolve();
      });

      const muteSpy = jest.spyOn(VoiceGatewayMock.prototype, 'mutePhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {phoneAudio: 'attendee-1-phone-audio', attendeeAdded: true}, controlSpy);

      expect(module.movePhonesInProgress.has('attendee-1-phone-audio')).toBeFalsy();
      expect(muteSpy).not.toBeCalled();
    });

    it('kick phone because kickOut', async () => {
      const controlSpy = jest.fn(data => {
        return Promise.resolve();
      });

      const spy = jest.spyOn(VoiceGatewayMock.prototype, 'kickPhone');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {kickedOut: 'any reason'}, controlSpy);

      expect(spy).toBeCalledWith('attendee-1-phone-audio', expect.any(String));
    });

    it('clear time out if attendee is gone but has attach phone', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', data);
        return Promise.resolve();
      });

      const spy = jest.spyOn(MockMeeting.prototype, 'clearRemoveAttendeeDelay');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: '',
        left: true,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {phoneAudio: 'attendee-1-phone-audio'}, controlSpy);

      expect(spy).toBeCalled();
    });

    it('remove if phone without attendee has left', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', data);
        return Promise.resolve();
      });

      const spy = jest.spyOn(MockMeeting.prototype, 'removeAttendee');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.PHONE,
        staticRole: Roles.PHONE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {left: true}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        left: true
      }));
      expect(spy).toBeCalledWith('attendee-1');
    });

    it('setup idle time if phone without attendee has left', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', data);
        return Promise.resolve();
      });

      const spy = jest.spyOn(MockMeeting.prototype, 'setupRemoveAttendeeDelay');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.PHONE,
        staticRole: Roles.ATTENDEE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {left: true}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        left: true
      }));
      expect(spy).toBeCalledWith('attendee-1');
    });

    it('remove immediately attendee list item phone if anonymous phone has left', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', data);
        return Promise.resolve();
      });

      const spy = jest.spyOn(MockMeeting.prototype, 'removeAttendee');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.PHONE,
        staticRole: Roles.PHONE,
        micState: MicState.normal
      });

      await module.approveAttendeeChange(null, 'attendee-1', {left: true}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        left: true
      }));
      expect(spy).toBeCalledWith('attendee-1');
    });

    it('toggle workers if attendee with attach phone change room', async () => {
      const controlSpy = jest.fn(data => {
        module.inst.attendeeStorage.updateAttendee('attendee-1', data);
        return Promise.resolve();
      });

      const spyStop = jest.spyOn(MockVoiceWorker.prototype, 'stop');
      const spyStart = jest.spyOn(MockVoiceWorker.prototype, 'start');

      module = createModule(VoiceModule) as VoiceModule;
      module.inst.model = {...workData};
      module.inst.attendeeStorage.addAttendee({
        id: 'attendee-1',
        room: '',
        phoneAudio: 'attendee-1-phone-audio',
        left: false,
        role: Roles.ATTENDEE,
        micState: MicState.normal
      });

      const worker = module.createWorker({id: ''} as BoxWorkerBasePayload);
      worker.__status = BoxWorkerStatus.STARTED;

      await module.approveAttendeeChange(null, 'attendee-1', {room: 'room-id'}, controlSpy);

      expect(controlSpy).toBeCalledWith(expect.objectContaining({
        room: 'room-id'
      }));
      expect(spyStart).toBeCalledTimes(1);
      expect(spyStop).toBeCalledTimes(1);
      expect(module.workerStore.has('')).toBeFalsy();
      expect(module.workerStore.has('room-id')).toBeTruthy();
    });
  });
});
