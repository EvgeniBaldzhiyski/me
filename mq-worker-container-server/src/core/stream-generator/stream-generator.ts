/* eslint-disable camelcase */
import {
  catchError, connect, distinctUntilChanged, filter, fromEventPattern,
  ignoreElements, map, mapTo, merge, mergeMap, Observable, retryWhen, scan, shareReplay, switchMap, take, tap, throwError, timeout, timer
} from 'rxjs';
import logger from '../logger';
import config from 'config';
import { createTabCommunicationBind, createTabCommunicationObservable } from '../tab-monitoring/tab-monitoring';
import { AppRefreshError, MonitoringApi, TabCommunicationError } from '../tab-monitoring/@resources';

let tabId = -1;

export function onTabCaptureStatusChanged(event: chrome.tabCapture.CaptureInfo): void {
  logger.debug(`tabCapture.onStatusChanged ${event.status}`);
}

export const getRefWindow = new Observable<NWJS_Helpers.win>(observer => {
  logger.debug('FETCH WINDOW');

  let ref: NWJS_Helpers.win;

  if (!!config.get('service.inspectMedia')) {
    nw.Window.open('chrome://media-internals/', {}, () => {
      logger.debug('OPENING MEDIA INSPECTOR');
    });
  }

  nw.Window.open('index.html', {}, w => {
    logger.log('RECEIVE WINDOW');

    ref = w;

    observer.next(ref);

    ref.window.chrome.tabCapture.onStatusChanged.addListener(onTabCaptureStatusChanged);
  });

  return () => {
    if (ref) {
      ref.window.chrome.tabCapture.onStatusChanged.removeListener(onTabCaptureStatusChanged);
    }

    ref = undefined;
  };
}).pipe(
  shareReplay(1),
);

export function createTab(ref: NWJS_Helpers.win, url: string): Observable<number> {
  tabId = -1;
  let closeBeforeOpen = false;

  return fromEventPattern(next => {
    ref.window.chrome.tabs.create({url}, tab => {
      logger.log(`CREATE A TAB: ${tab.id}`);
      chrome.tabs.update(tab.id, {autoDiscardable: false});

      if (closeBeforeOpen) {
        logger.log(`CLOSE OBSOLETE TAB ${tab.id}`);
        ref.window.chrome.tabs.remove(tab.id);
        return;
      }

      next(tabId = tab.id);
    });
  }, () => {
    closeBeforeOpen = true;

    if (tabId > -1) {
      logger.log(`CLOSE TAB ${tabId}`);
      ref.window.chrome.tabs.remove(tabId);
    }
  });
}

export function onTabUpdate(): Observable<chrome.tabs.TabChangeInfo> {
  logger.log(`BIND TAB UPDATE LISTENER ${tabId}`);
  return fromEventPattern<[number, Record<string, string>]>(next => {
    const onUpdate = (id: number, info: Record<string, string>) => {
      next([id, info]);
    };
    chrome.tabs.onUpdated.addListener(onUpdate);
    return onUpdate;
  }, (_, onUpdate) => {
    logger.log(`REMOVE TAB UPDATE LISTENER ${tabId}`);
    chrome.tabs.onUpdated.removeListener(onUpdate);
  }).pipe(
    filter(([id]) => id === tabId),
    map(([, value]) => value),
    scan((acc, value) => ({...acc, ...value}), {}),
  );
}

export function createTabMonitoring(targetTabId: number): Observable<void> {
  return createTabCommunicationObservable(targetTabId).pipe(
    switchMap(stream => createTabCommunicationBind(stream)),
    retryWhen((attempts: Observable<unknown>) => attempts.pipe(
      mergeMap((error: unknown) => {
        if (!(error instanceof AppRefreshError)) {
          return throwError(() => error);
        }
        return timer(100);
      }),
    ))
  );
}

export function capturing(ref: NWJS_Helpers.win, constrains: chrome.tabCapture.CaptureOptions): Observable<MediaStream> {
  return new Observable<MediaStream>(observer => {
    let stream: MediaStream;

    ref.window.chrome.tabCapture.capture(constrains, s => {
      logger.log('FETCH STREAM');

      if (!s || !s.active) {
        observer.error(new Error('Stream is invalid or isn\'t active.'));
      }
      observer.next(stream = s);
    });

    return () => {
      logger.debug('CLEAR STREAM');

      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
          stream.removeTrack(track);
        }

        stream = undefined;
      }
    };
  }).pipe(
    catchError((err: Error) => {
      err.message = `Capturing has failed: ${err.message}`;

      return throwError(() => err);
    })
  );
}

export function generateMediaStream(
  url: string,
  constrains: chrome.tabCapture.CaptureOptions = {audio: true, video: false}
): Observable<MediaStream> {
  return getRefWindow.pipe(
    switchMap(ref => createTab(ref, url).pipe(
      switchMap(targetTabId =>
        onTabUpdate().pipe(
          connect(tabUpdate$ =>
            merge(
              // this workaround for covering NGINX delivery failures. More info here: base-box/templates/dummy-nginx.html and JIG-11659
              tabUpdate$.pipe(
                filter(info => 'title' in info && !info.title.includes('.jigsawinteractive.com')),
                timeout({
                  first: parseInt(config.get('service.documentDeliveryTimeout'), 10),
                  with: () => throwError(
                    () => new TabCommunicationError('Tab failed to be delivered by NGINX', MonitoringApi.APP_INITIALIZED)
                  )
                }),
                take(1),
                switchMap(() => createTabMonitoring(targetTabId))
              ),
              tabUpdate$.pipe(
                tap((tabInfo) => {
                  if (tabInfo?.discarded) {
                    throw new Error('Tab has been discarded by Chromium');
                  }

                  // TODO: MOVE TO DEBUG AFTER COMPLETING INVESTIGATION
                  logger.warn(`ON TAB UPDATE ${tabId} ${JSON.stringify(tabInfo)}`);
                }),
                ignoreElements()
              )
            )
          )
        ).pipe(
          // Upon refresh settings capturing stream should not be interrupted. The job will be stopped from Socket Server
          mapTo(1),
          distinctUntilChanged(),
          switchMap(() => capturing(ref, constrains))
        ),
      ),
    ))
  );
}
