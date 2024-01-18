import { getFile } from '../../utils/comm.facade';
import config from '../../utils/config';
import { GetFileOptions } from '../../utils/interfaces';

export function onMutation(targetNode: Node, filter?: () => boolean) {
  return new Promise((resolve) => {
    const observer = new MutationObserver((mutationsList, o) => {
      if (!filter || filter() === true) {
        o.disconnect();
        resolve(true);
      }
    });
    observer.observe(targetNode, { childList: true, subtree: true });
  });
}

export function element<R extends HTMLElement>(selector: string, allowUndefined = false): R {
  let el: R;

  if (selector[0] === '#') {
    el = document.getElementById(selector.substr(1)) as R;
  } else if (selector[0] === '@') {
    el = document.getElementsByName(selector.substring(1))?.item(0) as R;
  } else {
    el = document.querySelector<R>(selector);
  }

  if (!el && !allowUndefined) {
    throw new Error(`Critical UI problem. Element with selector "${selector}" is missing`);
  }

  return el;
}

export function elements<R extends HTMLElement>(selector: string, allowUndefined = false): R[] {
  let els: NodeListOf<R>;

  if (selector[0] === '@') {
    els = document.getElementsByName(selector.substring(1)) as NodeListOf<R>;
  } else {
    els = document.querySelectorAll<R>(selector);
  }

  if (!els.length && !allowUndefined) {
    throw new Error(`Critical UI problem. Element with selector "${selector}" is missing`);
  }

  return Array.from(els);
}

export function selectValueByTextByNode(node: HTMLSelectElement, text: string, mode: 'regex' | 'strictMatch' | 'include' = 'strictMatch') {
  for (const option of Array.from(node.options)) {
    if (mode === 'strictMatch') {
      if (option.innerText.trim() === text.trim()) {
        return (node.value = option.value);
      }
    }

    if (mode === 'include') {
      if(option.innerText.includes(text.trim())) {
        return (node.value = option.value);
      }
    }

    if (mode === 'regex') {
      // Under construction
    }
  }
  return '';
}

export function selectValueByText(selector: string, match: string, mode: 'regex' | 'strictMatch' | 'include' = 'strictMatch'): string {
  return selectValueByTextByNode(element<HTMLSelectElement>(selector), match, mode);
}

export async function fillFormFile(
  selector: string | HTMLInputElement,
  options: string | GetFileOptions,
  filename?: string
): Promise<void> {
  if (options && (typeof options !== 'object')) {
    options = {
      method: 'post',
      url: config.get('api.links.fileDownload'),
      data: [options]
    };
  }
  const {blob, name} = await getFile(options as GetFileOptions);

  const myFile = new File([blob], filename || name || 'unknown', {
    type: blob.type,
    lastModified: Date.now(),
  });

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(myFile);

  const fileInput = typeof selector !== 'string' ? selector : element<HTMLInputElement>(selector);
  fileInput.files = dataTransfer.files;

  fileInput.dispatchEvent(new Event('change'));
}

export function fillFormText<E extends HTMLInputElement>(selector: string | E, value: string) {
  const el = (typeof selector === 'string' ? element<E>(selector) : selector);

  el.dispatchEvent(new Event('focusin', { bubbles: true }));
  el.value = value;
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('focusout', { bubbles: true }));
  el.dispatchEvent(new Event('blur'));
}

export function sleep(duration: number): Promise<void> {
  return new Promise(resolve => setTimeout(() => resolve(), duration));
}
