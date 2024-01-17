import { Attendee, Room } from '@container/models';

export type CallSid = string;

export interface VoiceCandidate {
  status: 1 | 0;
  callsid: CallSid;
  aid: Attendee['id'];
  firstName: Attendee['firstName'];
  lastName: Attendee['lastName'];
  role: Attendee['role'];
  uid: Attendee['userAccountID'];
}
export interface VoiceCandidateItem {
  candidate: VoiceCandidate;
  active: boolean;
  data?: Partial<Attendee>;
}

export interface VoiceSpeaking {
  aid: Attendee['id'];
  callSid: string;
  speaking: '0' | '1';
}

export interface VoiceCallme {
  reqOwner: Attendee['id'];
  aid: Attendee['id'];
  extension: string;
  code: number;
  phone: number;
}

export interface VoiceDialOut {
  reqOwner: Attendee['id'];
  aid: Attendee['id'];
}

export interface VoiceRefClient {
  room: Room['id'];
  server: 1 | 0;
  kill: 1 | 0;
}

export interface VoiceGatewayCommandRes<R = any> {
  status: number;
  statusText: string;
  data?: R;
}

export enum VoiceGatewayEventType {
  JOIN,
  REQUEST,
  SPEAKING,
  DIAL_OUT,
  CALL_ME,
  REF_CLIENT
}

export interface VoiceGatewayEvent<T = VoiceGatewayEventType, D = unknown> {
  readonly type: T;
  readonly data: D;
}

export interface VoiceGatewayJoin extends VoiceGatewayEvent<VoiceGatewayEventType.JOIN, CallSid> { }
export interface VoiceGatewayRequest extends VoiceGatewayEvent<VoiceGatewayEventType.REQUEST, VoiceCandidate> { }
export interface VoiceGatewaySpeaking extends VoiceGatewayEvent<VoiceGatewayEventType.SPEAKING, VoiceSpeaking> { }
export interface VoiceGatewayDialOut extends VoiceGatewayEvent<VoiceGatewayEventType.DIAL_OUT, VoiceDialOut> { }
export interface VoiceGatewayCallme extends VoiceGatewayEvent<VoiceGatewayEventType.CALL_ME, VoiceCallme> { }
export interface VoiceGatewayRefClient extends VoiceGatewayEvent<VoiceGatewayEventType.REF_CLIENT, VoiceRefClient> { }
