import { Targets } from './targets.enum';


declare global {
  interface Window {
    noty: (data: {
      text: string;
      modal?: boolean;
      layout?: 'center' | string;
      type: 'error' | 'warning' | 'info';
      timeout?: number;
      progressBar?: boolean;
      theme?: 'bootstrapTheme' | string;
      closeWith?: ['click'];
      callback?: any;
    }) => void;
    $: (query: any) => object;
    currentTarget: Targets;
  }
  const noty: (data: {
    text: string;
    modal?: boolean;
    layout?: 'center' | string;
    type: 'error' | 'warning' | 'info';
    timeout?: number;
    progressBar?: boolean;
    theme?: 'bootstrapTheme' | string;
    closeWith?: ['click'];
    callback?: any;
  }) => void;
  const $: (query: any) => any;
  let currentTarget: Targets;
}

declare module 'types.d' {
  // empty
}
