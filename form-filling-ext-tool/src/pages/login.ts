import { ApiClientError } from '../utils/api.client';
import { isLogged, login } from '../utils/comm.facade';
import config from '../utils/config';
import { PAGES, goTo } from './utils/route';

void (async () => {
  const logged = await isLogged();

  if (logged) {
    return goTo(PAGES.POSTINGS);
  }

  $('#build-version-box').text(config.get('version'));

  $('#loginForm').submit((event: Event) => {
    event.preventDefault();

    $('#loadingBoard').show();

    void (async () => {
      const res = await login($('#email').val() as string, $('#password').val() as string);

      const {type, code} = res as ApiClientError;
      if (type === 'ApiClientError') {
        let text = `Internal server error (${code})`;
        if (code === 401) {
          text = 'Bad credential. Please check your credentials!';
        }

        $('#loadingBoard').hide();

        noty({
          text,
          modal: true,
          layout: 'center',
          type: 'error',
          timeout: 1000,
          progressBar: true,
          theme: 'bootstrapTheme',
          closeWith: ['click']
        });
        console.error(res);
        return;
      }

      return goTo(PAGES.POSTINGS);
    })();
  });

  if (config.get('auth.name')) {
    $('#email').val(config.get('auth.name'));
  }

  if (config.get('auth.pass')) {
    $('#password').val(config.get('auth.pass'));
  }
})();
