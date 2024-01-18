/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable no-invalid-this */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable arrow-body-style */
/* eslint-disable unused-imports/no-unused-imports-ts */

import { delay, firstValueFrom, lastValueFrom, of, take, tap } from 'rxjs';
import { EventEmitter } from 'events';
import { MockMediaStream } from '../../../__mock__/mock-nwjs';

/* eslint-disable @typescript-eslint/no-unused-vars */
require('../../../__mock__/mock-apm');

class MockCoreApi {
  get() {
    return of({data: 'TOKEN'});
  }
}

jest.mock('../../../communication/core-api.client', () => {
  const originalModule = jest.requireActual('../../../communication/core-api.client');
  return {__esModule: true, ...originalModule,
    coreApi: new MockCoreApi(),
  };
});

class MockCall extends EventEmitter {
  constructor() {
    super();
    this._TEST();
  }

  getRemoteStream() {
    return new MockMediaStream();
  }

  status() {
    return '';
  }

  _TEST() {}
}
class MockDevice extends EventEmitter {
  static EventName =  {
    Error: 'error',
    Incoming: 'incoming',
    Destroyed: 'destroyed',
    Unregistered: 'unregistered',
    Registering: 'registering',
    Registered: 'registered',
    TokenWillExpire: 'tokenWillExpire'
  };

  constructor() {
    super();
    this._TEST();
  }

  connect(options?) {
    return Promise.resolve(new MockCall());
  }

  destroy() {}
  updateToken() {}

  _TEST() {}
}

jest.mock('@twilio/voice-sdk', () => {
  return {
    __esModule: true,
    Device: MockDevice,
    Call: MockCall
  };
});

import { TwilioVoiceProvider } from './twilio-voice.provider';


beforeAll(() => {
  require('../../../__mock__/mock-nwjs');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const provider = new TwilioVoiceProvider();


it('ОК', async () => {
  jest.spyOn(MockCall.prototype, '_TEST').mockImplementation(function() {
    setTimeout(() => {
      this.emit('sample');
    }, 10);
  });
  const spyOnCoreApi = jest.spyOn(MockCoreApi.prototype, 'get');
  const spyOnDeviceConnect = jest.spyOn(MockDevice.prototype, 'connect');
  const spyDeviceDestroy = jest.spyOn(MockDevice.prototype, 'destroy');

  const stream = await firstValueFrom(provider.exchange('meeting-id','room-id', {} as MediaStream));

  expect(stream).toBeInstanceOf(MockMediaStream);
  expect(spyOnCoreApi).toHaveBeenCalledWith('/twilio/token/meeting-id');
  expect(spyOnDeviceConnect).toHaveBeenCalledWith({ params: { SipCallId: 'room-id' } });
  expect(spyDeviceDestroy).toBeCalled();
});

it('OK - Device (token expire)', async () => {
  jest.spyOn(MockCall.prototype, '_TEST').mockImplementation(function() {
    setTimeout(() => this.emit('sample'), 10);
  });
  jest.spyOn(MockDevice.prototype, '_TEST').mockImplementation(function() {
    setTimeout(() => this.emit('tokenWillExpire'), 15);
  });

  const spyExpToken = jest.spyOn(MockDevice.prototype, 'updateToken');

  await lastValueFrom(provider.exchange('meeting-id','room-id', {} as MediaStream).pipe(
    delay(20),
    take(1)
  ));
  expect(spyExpToken).toBeCalledWith('TOKEN');
});

describe('Fail', () => {
  it('Device (runtime error)', async () => {
    jest.spyOn(MockDevice.prototype, '_TEST').mockImplementation(function() {
      setTimeout(() => this.emit('error', new Error('{{TEST_ERROR}}')));
    });

    let errorMessage;

    try{
      await lastValueFrom(provider.exchange('meeting-id','room-id', {} as MediaStream));
    }catch(error) {
      errorMessage = error;
    }

    expect(errorMessage).toBeTruthy();
  });

  it('Call (runtime error)', async () => {
    let errorMessage: Error;
    jest.spyOn(MockDevice.prototype, '_TEST').mockImplementation(function() {
      setTimeout(() => this.emit('sample'), 10);
      setTimeout(() => this.emit('error', new Error('{{TEST_ERROR}}')), 15);
    });

    try {
      await lastValueFrom(provider.exchange('meeting-id','room-id', {} as MediaStream));
    } catch(er) {
      errorMessage = er;
    }
    expect(errorMessage).toBeTruthy();
  });

  it('Call (runtime disconnect)', async () => {
    jest.spyOn(MockCall.prototype, '_TEST').mockImplementation(function() {
      setTimeout(() => this.emit('sample'), 10);
      setTimeout(() => this.emit('disconnect', new Error('{{TEST_ERROR}}')), 15);
    });

    let testError;
    let testFail = false;

    try {
      await lastValueFrom(provider.exchange('meeting-id','room-id', {} as MediaStream).pipe(
        delay(20),
        tap(() => (testFail = true)), // be sure the test will complete in expected time
        take(1)
      ));
    } catch(er) {
      testError  = er;
    }
    expect(testFail).toBeTruthy();
  });

  it('CoreApi GET access token throws an error', async () => {
    jest.spyOn(MockCoreApi.prototype, 'get').mockImplementation(() => {
      throw new Error('{{TEST_ERROR}}');
    });

    let testError;
    try {
      await firstValueFrom(provider.exchange('meeting-id','room-id', {} as MediaStream));
    } catch(er) {
      testError = er;
    }
    expect(testError).toBeTruthy();
  });
});
