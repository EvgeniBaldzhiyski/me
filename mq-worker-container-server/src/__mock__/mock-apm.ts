/* eslint-disable arrow-body-style */
/* eslint-disable no-trailing-spaces */
export class MockApmTransaction {
  ids = {
    'transaction.id': 'transaction.id'
  };
  startSpan = jest.fn(() => {
    return {
      ids: {
        'span.id': 'span.id'
      },
      end: jest.fn()
    };
  });
}

export class MockApm {
  flush = jest.fn();
  captureError = jest.fn();
  setCustomContext = jest.fn();
  Logger = jest.fn();
  currentTraceIds = {
    'trace.id': 'trace.id',
    'transaction.id': 'transaction.id',
    'span.id': 'span.id'
  };
  startTransaction = jest.fn(() => {
    return new MockApmTransaction();
  });
}

jest.mock('elastic-apm-node/start', () => {
  // const originalModule = jest.requireActual('elastic-apm-node/start');
  return { __esModule: true, /* ...originalModule, */ default: new MockApm() };
});
