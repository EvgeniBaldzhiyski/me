import { element as defaultElement } from '../utils/dom';

export function element<R extends HTMLInputElement>(selector: string, allowUndefined = false): R {
  return defaultElement<R>(selector, allowUndefined);
}
