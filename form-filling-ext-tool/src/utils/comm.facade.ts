import { ApiClientError, LoginResponse } from './api.client';
import { Command, Commands, TargetData, TargetDataState, TargetId, TargetPosting } from './comm.map';
import { v4 } from 'uuid';
import { GetFileOptions, PostingItem } from './interfaces';
import { Targets } from '../targets.enum';

function makeTransaction<R>(command: Command): Promise<R> {
  const id = v4();

  void chrome.runtime.sendMessage({...command, id});

  return new Promise<R>(resolve => {
    function local({cmd, data, id: iid}, _, res) {
      res('OK');

      if (cmd === Commands.RESPONSE_TRANSACTION && iid === id) {
        chrome.runtime.onMessage.removeListener(local);
        resolve(data as R);
      }
    }

    chrome.runtime.onMessage.addListener(local);
  });
}

// check if there has logging token
export function isLogged(): Promise<boolean> {
  return chrome.runtime.sendMessage({cmd: Commands.IS_LOGGED});
}

// remove login token
export function logout(): Promise<void> {
  return chrome.runtime.sendMessage({cmd: Commands.LOGOUT});
}

// fetch login token
export function login(name: string, pass: string): Promise<LoginResponse | ApiClientError> {
  return makeTransaction({cmd: Commands.LOGIN, data: {name, pass}});
}

// ask current tab for target id
export function getTargetId(): Promise<TargetId> {
  return makeTransaction({cmd: Commands.GET_TARGET_ID});
}

// used from inject scripts to subscribe for commands received from background script
export function waitForCommand<D = unknown, R = unknown>(
  command: Commands | '*',
  target: Targets,
  callback: (o?: {
    res: (response?: R) => void;
    data: D;
  }) => void
): void {
  chrome.runtime.onMessage.addListener(({cmd, target: _target, data}: Command<D>, _, res) => {
    if ((_target === undefined || target === _target) && (command === '*' || cmd === command)) {
      callback({res, data});
    }
  });
}

export function getPostings(target: Targets, refresh?: boolean): Promise<{postings: PostingItem[]; selectedId: string}> {
  const data = refresh ? {refresh: true} : undefined;
  return makeTransaction({cmd: Commands.GET_TARGET_POSTINGS, target, data});
}

export function fetchData<T>(url: string, payload: object, options: object): Promise<T> {
  return makeTransaction({cmd: Commands.FETCH_DATA, data: {url, payload, options}});
}

export async function getFile(options: GetFileOptions): Promise<{blob: Blob; name: string}> {
  const {base64, name} = await makeTransaction<{base64: RequestInfo; name: string}>({cmd: Commands.GET_FILE, data: {options}});

  const response = await fetch(base64);
  const blob = await response.blob();

  return {blob, name};
}

export function selectPosting(target: Targets, id: string): void {
  void chrome.runtime.sendMessage({cmd: Commands.SET_SELECTED_POSTING_ID, target, data: {id}});
}

export function getSelectedPostingId(target: Targets): Promise<string> {
  return chrome.runtime.sendMessage({cmd: Commands.GET_SELECTED_POSTING_ID, target});
}

export function selectEmployeeIds(target: Targets, ids: string[]): void {
  void chrome.runtime.sendMessage({cmd: Commands.SET_SELECTED_EMPLOYEE_IDS, target, data: {ids}});
}

export function getSelectedEmployeeIds(target: Targets): Promise<string[]> {
  return chrome.runtime.sendMessage({cmd: Commands.GET_SELECTED_EMPLOYEE_IDS, target});
}

export function getTargetPosting<D = object, S = unknown, E = string>(target: Targets): Promise<TargetPosting<D, S, E>> {
  return chrome.runtime.sendMessage({cmd: Commands.GET_TARGET_POSTING, target});
}

export async function setTargetPostingState<S extends TargetDataState>(target: Targets, state: S): Promise<void> {
  await chrome.runtime.sendMessage({cmd: Commands.SET_POSTING_STATE, target, data: {state}});

  return Promise.resolve();
}

export function setTargetPosting<D = object, S = unknown>(target: Targets, id?: string): Promise<TargetData<D, S>> {
  return makeTransaction<TargetData<D, S>>({cmd: Commands.SET_TARGET_POSTING, target, data: {id}});
}

export async function clearTargetPosting(target: Targets): Promise<void> {
  await chrome.runtime.sendMessage({cmd: Commands.CLEAR_TARGET_POSTING, target});

  return Promise.resolve();
}

export function prepareToFilling<R = object>(target: Targets): Promise<R> {
  return makeTransaction<R>({cmd: Commands.PREPARE_FILLING, target});
}

export async function fillingIsEnding(target: Targets, message?: string): Promise<void> {
  await chrome.runtime.sendMessage<Command>({cmd: Commands.END_FILLING, target, data: message});

  return Promise.resolve();
}

export async function makeNotification(target: Targets, notification: string): Promise<void> {
  await chrome.runtime.sendMessage<Command>({cmd: Commands.SEND_NOTIFICATION, target, data: notification});

  return Promise.resolve();
}
