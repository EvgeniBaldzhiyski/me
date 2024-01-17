import {MockLogger, MockServerApi, MockCoreApiObservable } from '../../_TEST_/meeting-mocks.lib';
import ServerAPI from '../../../../../utils/ServerAPI';
import { Logger } from 'winston';


jest.mock('../../../../../utils/coreApiClient', () => {
  return {
    coreApiObservable: MockCoreApiObservable
  }
});

import { VoiceGateway } from './voice.gateway'; 
import { VoiceGatewayEventType } from './voice.interfaces';
import { of, throwError } from 'rxjs';


describe('VoiceGateway', () => {
  let voiceGatewayInstance: VoiceGateway;
  let voiceGatewayInstanceEventSpyOn;

  const voiceGatewaySpy = {
    onPhoneJoinSpy: jest.spyOn(VoiceGateway.prototype as any, 'onPhoneJoin'),
    onPhoneRequestSpy: jest.spyOn(VoiceGateway.prototype as any,'onPhoneRequest'),
    onPhoneSpeakingHandlerSpy: jest.spyOn(VoiceGateway.prototype as any,'onPhoneSpeakingHandler'),
    onDialOutSpy: jest.spyOn(VoiceGateway.prototype as any,'onDialOut'),
    onCallmeSpy: jest.spyOn(VoiceGateway.prototype as any,'onCallme'),
    onRefreshSsrClientSpy: jest.spyOn(VoiceGateway.prototype as any,'onRefreshSsrClient'),
    mutePhoneSpy: jest.spyOn(VoiceGateway.prototype, 'mutePhone'),
    movePhoneSpy: jest.spyOn(VoiceGateway.prototype, 'movePhone'),
    kickPhoneSpy: jest.spyOn(VoiceGateway.prototype, 'kickPhone'),
    callMeSpy: jest.spyOn(VoiceGateway.prototype, 'callMe'),
    holdPhoneSpy: jest.spyOn(VoiceGateway.prototype, 'holdPhone')
  }

  const mockCoreApySpy = {
    postSpy: jest.spyOn(MockCoreApiObservable, 'post')
  }

  beforeEach(() => {
    jest.clearAllMocks();
    voiceGatewayInstance = new VoiceGateway(
      new MockServerApi() as unknown as ServerAPI,
      new MockLogger() as unknown as Logger,
      'meeting-id',
      'meeting-run-id');
  });

  afterEach(() => {
    voiceGatewayInstance = undefined;
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('Voicegateway calls utility functions correctly', () => {
    let data;
    let candidate;
    let client;

    voiceGatewayInstanceEventSpyOn = jest.spyOn((voiceGatewayInstance as any).event$, 'next')
    data = {aid: 'attendee-id', callSid: 'call-sid'};
    (voiceGatewayInstance as any).onPhoneJoin(data);
    expect(voiceGatewaySpy.onPhoneJoinSpy).toHaveBeenCalled();
    expect(voiceGatewayInstanceEventSpyOn).toHaveBeenCalledWith({type: VoiceGatewayEventType.JOIN, data: 'call-sid'});

    candidate = {
      status: 1,
      callsid: 'call-sid',
      aid: 'attendee-id',
      firstName: 'attendee-firstName',
      lastName: 'attendee-lastName',
      role: 'Attendee',
      uid: 'attendee-uid',
    };
    (voiceGatewayInstance as any).onPhoneRequest(candidate);
    expect(voiceGatewaySpy.onPhoneRequestSpy).toHaveBeenCalled();
    expect(voiceGatewayInstanceEventSpyOn).toHaveBeenCalledWith({type: VoiceGatewayEventType.REQUEST, data: candidate});


    data = {
      aid: 'attendee-id',
      callSid: 'call-sid',
      speaking: '1'
    };
    (voiceGatewayInstance as any).onPhoneSpeakingHandler(data);
    expect(voiceGatewaySpy.onPhoneSpeakingHandlerSpy).toHaveBeenCalled();
    expect(voiceGatewayInstanceEventSpyOn).toHaveBeenCalledWith({type: VoiceGatewayEventType.SPEAKING, data});


    client = {data: { aid: 'att-id' }};
    (voiceGatewayInstance as any).onDialOut(client, 'id');
    expect(voiceGatewaySpy.onDialOutSpy).toHaveBeenCalled();
    expect(voiceGatewayInstanceEventSpyOn).toHaveBeenCalledWith({type: VoiceGatewayEventType.DIAL_OUT, data: { reqOwner: client.data.aid, aid: 'id' }});


    client = { data: { aid: 'att-id' } };
    data = { ext: 'ext', code: '100', phone: 'phone' };
    (voiceGatewayInstance as any).onCallme(client, data);
    expect(voiceGatewaySpy.onCallmeSpy).toHaveBeenCalled();
    expect(voiceGatewayInstanceEventSpyOn).toHaveBeenCalledWith({type: VoiceGatewayEventType.CALL_ME, data: { reqOwner: client.data.aid, aid: client.data.aid, extension: data.ext, code: data.code, phone: data.phone }});


    data = { room: 'room-id', server: 1, kill: 0 };
    (voiceGatewayInstance as any).onRefreshSsrClient(data);
    expect(voiceGatewaySpy.onRefreshSsrClientSpy).toHaveBeenCalled();
    expect(voiceGatewayInstanceEventSpyOn).toHaveBeenCalledWith({ type: VoiceGatewayEventType.REF_CLIENT, data });
  });

  it('VoiceGateway holdPhone() funtionality called correctly and hadling errors as expected', (done) => {
    voiceGatewayInstance.holdPhone('');
    expect(mockCoreApySpy.postSpy).not.toHaveBeenCalled();

    voiceGatewayInstance.holdPhone('call-sid');
    expect(mockCoreApySpy.postSpy).toHaveBeenCalled();

    jest.spyOn(MockCoreApiObservable, 'post').mockImplementationOnce(() => throwError(new Error('{{ERROR}}')));

    voiceGatewayInstance.holdPhone('call-sid')
    .toPromise()
    .then(v => {
      expect(v).toMatchObject({ status: 500, statusText: '{{ERROR}}' });
      done();
    });
  });

  it('VoiceGateway mutePhone() funtionality called correctly and hadling errors as expected', (done) => {
    voiceGatewayInstance.mutePhone('', true);
    expect(mockCoreApySpy.postSpy).not.toHaveBeenCalled();

    voiceGatewayInstance.mutePhone('id', true);
    expect(mockCoreApySpy.postSpy).toHaveBeenCalled();

    jest.spyOn(MockCoreApiObservable, 'post').mockImplementationOnce(() => throwError(new Error('{{ERROR}}')));

    voiceGatewayInstance.mutePhone('call-sid', true)
    .toPromise()
    .then(v => {
      expect(v).toMatchObject({ status: 500, statusText: '{{ERROR}}' });
      done();
    });
  });

  it('VoiceGateway movePhone() funtionality called correctly and hadling errors as expected', (done) => {
    voiceGatewayInstance.movePhone('', 'room-id');
    expect(mockCoreApySpy.postSpy).not.toHaveBeenCalled();

    voiceGatewayInstance.movePhone('id', 'room-id');
    expect(mockCoreApySpy.postSpy).toHaveBeenCalled();

    jest.spyOn(MockCoreApiObservable, 'post').mockImplementationOnce(() => throwError(new Error('{{ERROR}}')));

    voiceGatewayInstance.movePhone('call-sid', 'room-id').toPromise()
    .then(v => {
      expect(v).toMatchObject({ status: 500, statusText: '{{ERROR}}' });
      done();
    });
  });

  it('VoiceGateway kickPhone() funtionality called correctly and hadling errors as expected', (done) => {
    voiceGatewayInstance.kickPhone('', 'reason');
    expect(mockCoreApySpy.postSpy).not.toHaveBeenCalled();

    voiceGatewayInstance.kickPhone('id', 'reason');
    expect(mockCoreApySpy.postSpy).toHaveBeenCalled();

    jest.spyOn(MockCoreApiObservable, 'post').mockImplementationOnce(() => throwError(new Error('{{ERROR}}')));

    voiceGatewayInstance.kickPhone('call-sid', 'reason')
    .toPromise()
    .then(v => {
      expect(v).toMatchObject({ status: 500, statusText: '{{ERROR}}' });
      done();
    });
  });

});
