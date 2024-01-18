import { ApiClientError } from '../../utils/api.client';

export function showError(errorMessage: string, action?: () => void, consoleError?: ApiClientError) {
  noty({
    text: errorMessage,
    modal: true,
    layout: 'center',
    type: 'error',
    timeout: 10000,
    progressBar: true,
    theme: 'bootstrapTheme',
    closeWith: ['click'],
    callback: {
      afterClose: () => action && action(),
    }
  });

  if (consoleError) {
    console.error(consoleError);
  }
}

export function showNotification(message: string, action?: () => void, consoleError?: ApiClientError) {
  noty({
    text: message,
    modal: true,
    layout: 'center',
    type: 'info',
    timeout: 10000,
    progressBar: true,
    theme: 'bootstrapTheme',
    closeWith: ['click'],
    callback: {
      afterClose: () => action && action(),
    }
  });

  if (consoleError) {
    console.error(consoleError);
  }
}
