import { Targets } from '../../targets.enum';
import {
  fillingIsEnding,
  getTargetPosting,
  makeNotification,
  setTargetPostingState,
  waitForCommand,
} from '../../utils/comm.facade';
import { Commands, TargetDataState, TargetId, TargetPosting } from '../../utils/comm.map';
import config from '../../utils/config';

export type ProcessingEnterType = 'push' | 'pull';

export interface PageValidatorRespond {
  error?: string;
}
export type Processing<D, S, E> = (data: TargetPosting<D, S, E>, type: ProcessingEnterType) => Promise<void> | void;
export type PageValidator = () => PageValidatorRespond;

// --- simplify API for injection scripts >>

function defaultPageValidator(): PageValidatorRespond {
  try {
    // if entryPointUrl is missing config.get will throw an error, so will catch that error to make it optional
    if (!window.location.href.includes(config.get(`targets.${window.currentTarget}.entryPointUrl`))) {
      return ({
        error: config.get(`targets.${window.currentTarget}.invalidEntryPoint`) || 'Invalid Target Page',
      });
    }
  } catch (error) {
    // do nothing
  }

  return { };
}

export function init(target: Targets, pageValidator?: PageValidator) {
  window.currentTarget = target;

  waitForCommand<unknown, TargetId>(Commands.GET_TARGET_ID, window.currentTarget, ({ res }) => {
    res({
      ...(pageValidator || defaultPageValidator)(),
      targetId: window.currentTarget
    });
  });
}

export function fillingStart<P = unknown, S = unknown, E = string, R = unknown>(
  callback: (o?: { res: (response?: R) => void; data: TargetPosting<P, S, E> }) => void
): void {
  return waitForCommand(Commands.START_FILLING, window.currentTarget, callback);
}

export function fillingEnd(message?: string): Promise<void> {
  return fillingIsEnding(window.currentTarget, message);
}

export function notify(message?: string): Promise<void> {
  return makeNotification(window.currentTarget, message);
}

export function getPosting<D = object, S = unknown, E = string>(): Promise<TargetPosting<D, S, E>> {
  return getTargetPosting(window.currentTarget);
}

export function setPostingState<S extends TargetDataState>(state: S): Promise<void> {
  return setTargetPostingState(window.currentTarget, state);
}

export async function enter<D = object, S = unknown, E = string>(
  target: Targets,
  pageValidator: Processing<D, S, E> | PageValidator,
  processing?: Processing<D, S, E>
): Promise<void> {
  if (!processing) {
    processing = pageValidator as Processing<D, S, E>;
    pageValidator = undefined;
  }

  init(target, pageValidator as PageValidator);

  // wait for start processing
  fillingStart(({ res, data }) => {
    res({ accept: true });

    void processing(data as TargetPosting<D, S, E>, 'push');
  });

  // ask if there has any collected posting data
  const data = await getPosting<D, S, E>();
  void processing(data, 'pull');
}
