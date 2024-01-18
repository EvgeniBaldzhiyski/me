/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/quotes */
/* eslint-disable max-len */
/* eslint-disable arrow-body-style */
/* eslint-disable one-var */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable require-await */
import '../../__mock__/mock-apm';
import {
  MockMediaStream, MockNwWindow, MockNwWindowRef, MockTabs, MockTabsUpdate
} from '../../__mock__/mock-nwjs';
import { delay, firstValueFrom, ignoreElements, lastValueFrom, merge, Observable, of, Subject, take, takeWhile, tap } from 'rxjs';

const bus = new Subject();
const spyRunObservable = jest.fn();
const createTabCommunicationObservableMock = jest.fn();
const createTabCommunicationBindMock = jest.fn(() => of(undefined));
const pushToMonitoringEventCollectionMock = jest.fn();

function refreshTestResources() {
  createTabCommunicationObservableMock.mockImplementation(() => {
    return new Observable(observer => {
      spyRunObservable();
      observer.next(bus);
    });
  });
  createTabCommunicationBindMock.mockImplementation(() => {
    return of(undefined);
  });
}

jest.mock('../tab-monitoring/tab-monitoring', () => {
  const originalModule = jest.requireActual('../tab-monitoring/tab-monitoring');
  return { __esModule: true, ...originalModule,
    createTabCommunicationObservable: createTabCommunicationObservableMock,
    createTabCommunicationBind: createTabCommunicationBindMock,
    pushToMonitoringEventCollection: pushToMonitoringEventCollectionMock
  };
});

import { capturing, createTab, createTabMonitoring, generateMediaStream, getRefWindow, onTabUpdate } from './stream-generator';
import { AppRefreshError } from '../tab-monitoring/@resources';


describe('generate-media-stream', () => {
  beforeEach(async () => {
    nw.Window.open('');
    refreshTestResources();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('getRefWindow', async () => {
    const spy = jest.spyOn(MockNwWindow.prototype, 'open');

    const win1 =  await firstValueFrom(getRefWindow);
    const win2 =  await firstValueFrom(getRefWindow);

    expect(win1).toBe(win2);
    expect(spy).toBeCalledTimes(1);
  });

  describe('onTabUpdate', () => {
    it('Ok', async () => {
      const addSpy = jest.spyOn(MockTabsUpdate.prototype, 'addListener').mockImplementation(callback => {
        setTimeout(() => {
          callback(-1, {prop1: 'PROP1'});
          callback(-1, {prop2: 'PROP2'});
        });
      });
      const removeSpy = jest.spyOn(MockTabsUpdate.prototype, 'removeListener');

      const info = await lastValueFrom(onTabUpdate().pipe(take(2)));

      expect(info).toMatchObject({prop1: 'PROP1', prop2: 'PROP2'});
      expect(addSpy).toBeCalledTimes(1);
      expect(removeSpy).toBeCalledTimes(1);
    });
  });

  describe('createTab', () => {
    afterEach(() => {
      jest.restoreAllMocks();
      jest.clearAllMocks();
    });

    it('Ok', async () => {
      const spyTabRemove = jest.spyOn(MockTabs.prototype, 'remove');
      const spyTabCreate = jest.spyOn(MockTabs.prototype, 'create').mockImplementation((_, callback) => {
        callback({id: 1});
      });

      await firstValueFrom(createTab(new MockNwWindowRef() as any, 'http://about:blank'));

      expect(spyTabCreate).toBeCalledWith({url: 'http://about:blank'}, expect.any(Function));
      expect(spyTabRemove).toBeCalledWith(1);
      expect(spyTabRemove).toBeCalledTimes(1);
    });

    it('Fail', async () => {
      jest.spyOn(MockTabs.prototype, 'create').mockImplementation((_, callback) => {
        setTimeout(() => callback({id: 1}), 10);
      });
      const spy = jest.spyOn(MockTabs.prototype, 'remove');

      const tabId = await firstValueFrom(
        merge(
          of(-1).pipe(
            delay(20)
          ),
          createTab(new MockNwWindowRef() as any, 'http://about:blank').pipe(
            takeWhile(() => false)
          )
        )
      );

      expect(tabId).toBe(-1);
      expect(spy).toBeCalledWith(1);
    });
  });

  describe('capturing', () => {
    const win = new MockNwWindowRef() as any;

    afterEach(() => {
      jest.restoreAllMocks();
      jest.clearAllMocks();
    });

    it('Ok', async () => {
      const spyAddTrack = jest.spyOn(MockMediaStream.prototype, 'addTrack');
      const spyRemoveTrack = jest.spyOn(MockMediaStream.prototype, 'removeTrack');

      const stream = await firstValueFrom(capturing(win, {audio: true, video: true}));

      expect(stream).toBeInstanceOf(MockMediaStream);
      expect(spyAddTrack).toBeCalledTimes(2);
      expect(spyRemoveTrack).toBeCalledTimes(2);
    });

    it('Fail', async () => {
      const throwError = () => { throw new Error('{{TEST_ERROR}}'); };
      jest.spyOn(MockMediaStream.prototype, 'addTrack').mockImplementation(throwError);
      jest.spyOn(MockMediaStream.prototype, 'removeTrack').mockImplementation(throwError);

      let testError: Error;

      try {
        await firstValueFrom(capturing(win, {audio: true, video: true}));
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeTruthy();
    });
  });

  describe('createTabMonitoring', () => {
    it('Ok', async () => {
      jest.spyOn(MockTabsUpdate.prototype, 'removeListener');
      createTabCommunicationBindMock.mockImplementation(() => {
        return merge(
          of(true).pipe(
            delay(1),
            tap(() => { throw new AppRefreshError('TEST_ERROR'); }),
            ignoreElements()
          ),
          of(undefined)
        );
      });

      await lastValueFrom(createTabMonitoring(1).pipe(take(2)));

      expect(spyRunObservable).toBeCalledTimes(2);
    });

    it('Fail', async () => {
      jest.spyOn(MockTabsUpdate.prototype, 'removeListener');
      createTabCommunicationBindMock.mockImplementation(() => {
        return merge(
          of(true).pipe(
            delay(1),
            tap(() => { throw new Error('TEST_ERROR'); }),
            ignoreElements()
          ),
          of(undefined)
        );
      });

      let testError;

      try {
        await lastValueFrom(createTabMonitoring(1).pipe(take(2)));
      } catch (error) {
        testError = error;
      }

      expect(spyRunObservable).toBeCalledTimes(1);
      expect(testError).toBeTruthy();
    });
  });

  describe('generateMediaStream', () => {
    it('Ok', async () => {
      const stream = await firstValueFrom(
        generateMediaStream('http://about:blank', {audio: true, video: true})
      );

      expect(stream).toBeInstanceOf(MockMediaStream);
      expect(createTabCommunicationObservableMock).toBeCalledWith(1);
    });
  });
});
