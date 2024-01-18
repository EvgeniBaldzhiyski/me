/* eslint-disable arrow-body-style */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unused-imports/no-unused-imports-ts */
import '../../__mock__/mock-apm';
import { MockChromeApiScripting } from '../../__mock__/mock-nwjs';

import { delay, firstValueFrom, ignoreElements, lastValueFrom, merge, of, Subject, switchMap, tap } from 'rxjs';
import { createTabCommunicationBind, createTabCommunicationObservable } from './tab-monitoring';
import { AppRefreshError, MonitoringApi, MonitoringEvent } from './@resources';

describe('', () => {
  beforeEach(() => {
    const execSpy = jest.spyOn(MockChromeApiScripting.prototype, 'executeScript');
    nw.Window.open('');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('createTabCommunicationObservable', () => {
    it('Ok', async () => {
      const execSpy = jest.spyOn(MockChromeApiScripting.prototype, 'executeScript');

      const value = await firstValueFrom(createTabCommunicationObservable(1));

      expect(value).toBeInstanceOf(Subject);
      expect(chrome.runtime.onMessage.addListener).toBeCalled();
      expect(chrome.runtime.onMessage.removeListener).toBeCalled();
      expect(execSpy).toBeCalled();
    });
  });

  describe('createTabCommunicationBind', () => {
    it('Ok', async () => {
      const value = await firstValueFrom(
        createTabCommunicationObservable(1).pipe(
          switchMap(bus => merge(
            of(true).pipe(
              delay(1),
              tap(() => {
                bus.next({command: MonitoringApi.APP_READY} as MonitoringEvent);
                bus.next({command: MonitoringApi.ONLINE} as MonitoringEvent);
                bus.next({command: MonitoringApi.SOCKET_CONNECTION_CHANGE, body: 'connectionAccept'} as MonitoringEvent);
                bus.next({command: MonitoringApi.MEDIA_CONNECTION_CHANGE, body: 'ONLINE'} as MonitoringEvent);
              })
            ),
            createTabCommunicationBind(bus)
          ))
        )
      );

      expect(value).toBe(undefined);
    });

    it('Fail(APP_READY is missing)', async () => {
      let testError;

      try {
        await firstValueFrom(
          createTabCommunicationObservable(1).pipe(
            switchMap(bus => createTabCommunicationBind(bus))
          )
        );
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeTruthy();
    });

    it('Fail(ONLINE is missing)', async () => {
      let testError;

      try {
        await firstValueFrom(
          createTabCommunicationObservable(1).pipe(
            switchMap(bus => merge(
              of(true).pipe(
                delay(1),
                tap(() => {
                  bus.next({command: MonitoringApi.APP_READY} as MonitoringEvent);
                }),
                ignoreElements()
              ),
              createTabCommunicationBind(bus))
            )
          )
        );
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeTruthy();
    });

    it('Fail(SOCKET_CONNECTION_CHANGE is missing)', async () => {
      let testError;

      try {
        await firstValueFrom(
          createTabCommunicationObservable(1).pipe(
            switchMap(bus => merge(
              of(true).pipe(
                delay(1),
                tap(() => {
                  bus.next({command: MonitoringApi.APP_READY} as MonitoringEvent);
                  bus.next({command: MonitoringApi.ONLINE} as MonitoringEvent);
                }),
                ignoreElements()
              ),
              createTabCommunicationBind(bus))
            )
          )
        );
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeTruthy();
    });

    it('Fail(MEDIA_CONNECTION_CHANGE is missing)', async () => {
      let testError;

      try {
        await firstValueFrom(
          createTabCommunicationObservable(1).pipe(
            switchMap(bus => merge(
              of(true).pipe(
                delay(1),
                tap(() => {
                  bus.next({command: MonitoringApi.APP_READY} as MonitoringEvent);
                  bus.next({command: MonitoringApi.ONLINE} as MonitoringEvent);
                  bus.next({command: MonitoringApi.SOCKET_CONNECTION_CHANGE, body: 'connectionAccept'} as MonitoringEvent);
                }),
                ignoreElements()
              ),
              createTabCommunicationBind(bus))
            )
          )
        );
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeTruthy();
    });

    it('Fail(ALIVE is missing)', async () => {
      let testError;

      try {
        await lastValueFrom(
          createTabCommunicationObservable(1).pipe(
            switchMap(bus => merge(
              of(true).pipe(
                delay(1),
                tap(() => {
                  bus.next({command: MonitoringApi.APP_READY} as MonitoringEvent);
                  bus.next({command: MonitoringApi.ONLINE} as MonitoringEvent);
                  bus.next({command: MonitoringApi.SOCKET_CONNECTION_CHANGE, body: 'connectionAccept'} as MonitoringEvent);
                  bus.next({command: MonitoringApi.MEDIA_CONNECTION_CHANGE, body: 'ONLINE'} as MonitoringEvent);
                }),
                ignoreElements()
              ),
              createTabCommunicationBind(bus))
            )
          )
        );
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeTruthy();
    });

    it('Ok(APP_REFRESH error is generated)', async () => {
      let testError;

      try {
        await firstValueFrom(
          createTabCommunicationObservable(1).pipe(
            switchMap(bus => merge(
              of(true).pipe(
                delay(1),
                tap(() => {
                  bus.next({command: MonitoringApi.APP_REFRESH} as MonitoringEvent);
                }),
                ignoreElements()
              ),
              createTabCommunicationBind(bus))
            )
          )
        );
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeInstanceOf(AppRefreshError);
    });
  });
});
