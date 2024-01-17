import serverConfig from '../com/utils/serverConfig';

// mock token sent in requests
serverConfig.CONFIG.apiServerToken = 'test-token';

import { coreApi } from '../com/utils/coreApiClient';

describe('coreApi testing', () => {

  it('test authorization header send in all requests', async () => {
    expect.assertions(1);

    let header = '';

    try{
      await coreApi.get('any-url');
    } catch (err) {
      if (err.request) {
        if (err.request._currentRequest) {
          header = err.request._currentRequest.getHeaders()['authorization'] as string;
        } else {
          header = err.request.getHeaders()['authorization'] as string;
        }
      }
    }

    expect(header).toEqual(`Bearer ${serverConfig.CONFIG.apiServerToken}`);
  });

});
