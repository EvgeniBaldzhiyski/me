import { Targets } from '../targets.enum';

export enum Commands {
  RESPONSE_TRANSACTION = 'RESPONSE_TRANSACTION',

  GET_TARGET_POSTING = 'GET_TARGET_POSTING',
  SET_TARGET_POSTING = 'SET_TARGET_POSTING',
  CLEAR_TARGET_POSTING = 'CLEAR_TARGET_POSTING',

  GET_TARGET_POSTINGS = 'GET_TARGET_POSTINGS',
  SET_TARGET_POSTINGS = 'SET_TARGET_POSTINGS',

  GET_FILE = 'GET_FILE',

  SET_POSTING_STATE = 'SET_POSTING_STATE',

  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  IS_LOGGED = 'IS_LOGGED',

  START_NOTIFICATION = 'START_NOTIFICATION',
  END_NOTIFICATION = 'END_NOTIFICATION',

  GET_TARGET_ID = 'GET_TARGET_ID',

  PREPARE_FILLING = 'START_FILLING',
  START_FILLING = 'START_FILLING',
  END_FILLING = 'END_FILLING',

  SEND_NOTIFICATION = 'SEND_NOTIFICATION',

  SET_SELECTED_POSTING_ID = 'SET_SELECTED_POSTING_ID',
  SET_SELECTED_EMPLOYEE_IDS = 'SET_SELECTED_EMPLOYEE_IDS',

  GET_SELECTED_POSTING_ID = 'GET_SELECTED_POSTING_ID',
  GET_SELECTED_EMPLOYEE_IDS = 'GET_SELECTED_EMPLOYEE_IDS',

  FETCH_DATA = 'FETCH_DATA',
}

export interface Command<D = unknown> {
  cmd: Commands;
  id?: string;
  target?: Targets;
  data?: D;
}

export type timestamp = number;
export interface TargetDataState {
  step: number;
}

export interface TargetData<D = object, S = unknown> {
  data?: D;
  id?: string;
  state?: S & TargetDataState;
  time?: timestamp;
}

export interface TargetPosting<D = object, S = unknown, E = string> {
  posting: TargetData<D, S>;
  employees: E[];
}

export interface TargetId {
  targetId: Targets;
  error?: string;
}
