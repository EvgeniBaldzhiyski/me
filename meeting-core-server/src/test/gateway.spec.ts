jest.mock('../com/database', () => {
  return {
    mongoClient: () => ({ close: () => {} }),
  };
});

jest.mock('@container/apm-utils', () => {
  return {
    // tslint:disable-next-line: arrow-return-shorthand
    ApmSpan: () => { return () => {}; },
    // tslint:disable-next-line: arrow-return-shorthand
    ApmTransaction: () => { return () => {}; },
    TransactionType: { WS_REQUEST: null }
  };
});

jest.mock('elastic-apm-node/start', () => {
  return {
    captureError: () => {},
    startSpan: () => ({ end: () => {} }),
  };
});

import Winston from 'winston';
Winston.createLogger = jest.fn(() => ({
  error: (...rest) => { console.log(rest.join(',')); },
  warn:  () => { },
  info:  () => { },
  log:  () => { },
  debug:  () => { },
} as any));

const res = { send: (code, message) => { } };

const params = {
  param1: 'param1',
  param2: 'param2',
  param3: 'param3',
};

/// Mock end =------------------------

import { ErrorCodes } from '@container/models';
import { gatewayScanner } from '../com/gateway/manager';
import { Post } from '../com/gateway/decorators/method.decorator';
import { Guard } from '../com/gateway/decorators/class.decorator';
import { jwt } from '../com/gateway/decorators/argument.decorator';
import { JwtSubjects } from '../com/gateway/types';

class TestApp {
  private propName() {
    return this;
  }

  private propName2(payload) {
    return payload;
  }
}

class TestModule {
  private propName() {
    return this;
  }
}

const headers = { 'authorization': 'Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InB1YmxpYzphMjlmOWYxMy1hZGNhLTRjYWQtYTQ5MC1lNTUyZTUzN2Y4MTciLCJ0eXAiOiJKV1QifQ.eyJhdWQiOlsiamlnc2F3LXNvY2tldC1zZXJ2ZXIiXSwiZXhwIjozMTg0NTg1Mzk4LCJpYXQiOjE2MDY3NDg1OTgsImlzcyI6IkppZ3NhdyBUZWFtIiwianRpIjoiOWZlMGE0Y2MtYTE2Mi00NjlmLTk5YjgtNDBhMWFmOGVkOGY0IiwibmJmIjoxNjA2NzQ4NTk4LCJzdWIiOiJqaWdzYXctY29yZS1hcGkifQ.iwZD3UbkX8zzA0B8JLSsYFP9n-VJRkv19jJtKUJaGaeYr0uv8YPoNmQCXC7aq9JSfCc-Pu1tKGKpH71FDRcjQDDwW1cYwWwFdifmLvqDz7Ejhj0jA_CNPahewiF_2kp3_JvJ-sqtdSJt8Ymk5P40PBeC0onzfMojBKTW5kHXYpOfK_Rd3thvDaBlbzsqjBaMGrNUhUMNrNViH7fUqyNF2RIzQYB_260d0wuszZ-rVOJpYjACjGWjx8iXI062fy7YRfG1w94ZNcfg2iTJq1lBHDEEprh5sUYPegcw5hmcAcMnFoCEzjnWrx94sYy-Iy22nlETGL7HmU-CcChLIhpzhA' };

describe('TWT guarding', () => {

  it('decorate method without guarding', async () => {
    let _endpoint;
    let _handler;

    Post('test-name')
      (TestApp.prototype, 'propName', Object.getOwnPropertyDescriptor(TestApp.prototype, 'propName'));

    const target = new TestApp;

    gatewayScanner(target, {
      onPost: (endpoint, handler) => {
        _endpoint = endpoint;
        _handler = handler;
      }
    } as any);

    const _target = await _handler({ headers }, res, params, {});

    expect(_endpoint).toBe('test-name');
    expect(_target).toEqual(target);
  });

  it('jwt guarding', async () => {
    expect.assertions(2);

    let _endpoint;
    let _handler;

    Post('test-name', '*')
      (TestApp.prototype, 'propName', Object.getOwnPropertyDescriptor(TestApp.prototype, 'propName'));

    const target = new TestApp;

    gatewayScanner(target, {
      onPost: (endpoint, handler) => {
        _endpoint = endpoint;
        _handler = handler;
      }
    } as any);

    const _target = await _handler({ headers }, res, params, {});

    expect(_endpoint).toBe('test-name');
    expect(_target).toEqual(target);
  });

  it('missing jwt but required', async () => {
    expect.assertions(1);

    let _handler;

    Post('test-name', '*')
      (TestApp.prototype, 'propName', Object.getOwnPropertyDescriptor(TestApp.prototype, 'propName'));

    const target = new TestApp;

    gatewayScanner(target, {
      onPost: (_, handler) => {
        _handler = handler;
      }
    } as any);

    let code = -1;

    try {
      await _handler({ headers: {} }, res, params, {});
    } catch (err) {
      code = 1;
    }

    expect(code).toEqual(1);
  });

  it('invalid subject', async () => {
    expect.assertions(1);

    let _handler;

    Post('test-name', ['test-for-invalid-subject'])
      (TestApp.prototype, 'propName', Object.getOwnPropertyDescriptor(TestApp.prototype, 'propName'));

    const target = new TestApp;

    gatewayScanner(target, {
      onPost: (_, handler) => {
        _handler = handler;
      }
    } as any);

    let code = -1;

    try {
      await _handler({ headers }, res, params, {});
    } catch (err) {
      code = err.code;
    }

    expect(code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('cascading permissions', async () => {
    expect.assertions(1);

    let _handler;

    Guard([JwtSubjects.CORE_API_SERVER])
      (TestApp);

    Post('test-name', ['test-for-invalid-subject'])
      (TestApp.prototype, 'propName', Object.getOwnPropertyDescriptor(TestApp.prototype, 'propName'));

    const target = new TestApp;

    gatewayScanner(target, {
      onPost: (_, handler) => {
        _handler = handler;
      }
    } as any);

    let message = 'Ok';

    try {
      await _handler({ headers }, res, params, {});
    } catch (err) {
      message = err.message;
    }

    expect(message).toBe('Ok');
  });

  it('cascading parent permissions', async () => {
    expect.assertions(1);

    let _handler;

    // decorate app
    Guard([JwtSubjects.CORE_API_SERVER])
      (TestApp);

    // decorate module
    Guard(['test-for-invalid-subject'])
      (TestModule);

    // decorate module method
    Post('test-name', ['test-for-invalid-subject'])
      (TestModule.prototype, 'propName', Object.getOwnPropertyDescriptor(TestModule.prototype, 'propName'));

    const app = new TestApp;
    const module = new TestModule;

    gatewayScanner(module, {
      onPost: (_, handler) => {
        _handler = handler;
      }
    } as any, [app]);

    let message = 'Ok';

    try {
      await _handler({ headers }, res, params, {});
    } catch (err) {
      message = err.message;
    }

    expect(message).toBe('Ok');
  });


  it('argument decoration', async () => {
    expect.assertions(1);

    let _handler;

    Post('test-name', '*')
      (TestApp.prototype, 'propName2', Object.getOwnPropertyDescriptor(TestApp.prototype, 'propName2'));

    jwt(TestApp.prototype, 'propName2', 0);

    const target = new TestApp;

    gatewayScanner(target, {
      onPost: (_, handler) => {
        _handler = handler;
      }
    } as any);

    const payload = await _handler({ headers }, res, params, {});

    expect(payload && payload.sub).toBeTruthy();
  });

});
