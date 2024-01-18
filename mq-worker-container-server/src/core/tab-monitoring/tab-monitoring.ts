import {
  catchError, combineLatest, filter, finalize, ignoreElements, merge, Observable,
  of, race, Subject, switchMap, take, tap, throwError, timeout
} from 'rxjs';
import logger from '../logger';
import config from 'config';
import { AppRefreshError, MonitoringApi, MonitoringEvent, TabCommunicationError } from './@resources';

/** @DEPRECATED */
let monitoringEventCollection: string[] = [];

/** @DEPRECATED */
const maxLogChunkLength = 1024;

/** @DEPRECATED */
// let lastAliveEvent: string;

export function timestampToTime(value?: number): string {
  const timeChunks = new Date(value || Date.now()).toTimeString().split(' ');

  return timeChunks[0];
}

/** @DEPRECATED */
export function pushToMonitoringEventCollection(info: unknown): void {
  monitoringEventCollection.push(
    `${timestampToTime()} TAB_UPDATE ${JSON.stringify(info).replace(/id_token=[^&]+&?/, 'id_token=...&')}`
  );
}

/** @DEPRECATED */
export function getMediaStreamLog(): string {
  return '';
  // return [...monitoringEventCollection, lastAliveEvent].join(',#');
}

/** @DEPRECATED */
export function getMonitoringEventCollection(): string[] {
  return {...monitoringEventCollection};
}

/** @DEPRECATED */
export function clearMonitoringEventCollection(): void {
  monitoringEventCollection = [];
}

/** @DEPRECATED */
export function getMediaStreamLogChinks(): Record<string, string> {
  const buffer = getMediaStreamLog();
  const chunkNumbers = parseInt(`${(buffer.length / maxLogChunkLength) + 1}`, 10);
  const chunks: Record<string, string> = {};

  for (let i = 0; i < chunkNumbers; i++) {
    chunks[`LogChunk${i}`] = (buffer.substring(i * maxLogChunkLength, (i + 1) * maxLogChunkLength));
  }

  return chunks;
}

export function createTabCommunicationObservable(targetTabId: number): Observable<Subject<MonitoringEvent>> {
  logger.debug(`TAB COMMUNICATION WITH TAB ID: ${targetTabId} is CLEATING...`);

  return new Observable(subscriber => {
    logger.debug(`TAB COMMUNICATION WITH TAB ID: ${targetTabId} is CREATED`);

    const communicationChannel = new Subject<MonitoringEvent>();

    const embeddedPageInjection = () => {
      window.addEventListener('message', ({data}) => chrome.runtime.sendMessage(data));
    };

    const handleCommunication = (event: MonitoringEvent) => {
      if (logger.level === 'debug') {
        logger.debug(`MESSAGE FROM TAB ID(${targetTabId}): ${JSON.stringify(event)}`);
      }

      if (event.scope === 'MonitoringServiceEvent') {
        communicationChannel.next(event);
      }
    };

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      function: embeddedPageInjection
    });

    chrome.runtime.onMessage.addListener(handleCommunication);
    subscriber.next(communicationChannel);

    return () => {
      communicationChannel.complete();
      chrome.runtime.onMessage.removeListener(handleCommunication);
      logger.debug(`REMOVING TAB COMMUNICATION WITH TAB ID: ${targetTabId}`);
    };
  });
}

export function createTabCommunicationBind(appEvents: Subject<MonitoringEvent>): Observable<void> {
  return merge(
    appEvents.pipe(
      filter(event => event.command !== MonitoringApi.ALIVE),
      tap(({command, timestamp, body}) => {
        const sBody = JSON.stringify(body);
        const msg = `${timestampToTime(timestamp)} ${command} ${sBody}`;

        switch (command) {
          case MonitoringApi.SOCKET_CONNECTION_CHANGE:
          case MonitoringApi.MEDIA_CONNECTION_CHANGE:
            logger.debug(msg);
            break;
          case MonitoringApi.ERROR_EVENT:
            logger.error(body.message);
            break;
          default:
            logger.warn(msg);
        }
      }),
      ignoreElements()
    ),
    appEvents.pipe(
      filter(event => event.command === MonitoringApi.OFFLINE),
      // tap(() => {
      //   throw new TabCommunicationError('tab application has gone offline', MonitoringApi.OFFLINE);
      // }),
      ignoreElements()
    ),
    merge(
      appEvents.pipe(
        filter(event => event.command === MonitoringApi.APP_EXIT_ERROR),
      ),
      appEvents.pipe(
        filter(event => event.command === MonitoringApi.APP_EXIT_LOGOUT),
      ),
    ).pipe(
      tap(() => {
        throw new Error('Web App went to logout or exit page');
      }),
      ignoreElements()
    ),
    race(
      appEvents.pipe(
        filter(event => event.command === MonitoringApi.APP_INITIALIZED),
        timeout({
          first: parseInt(config.get('service.initializedEventTimeout'), 10),
          with: () => throwError(() => new TabCommunicationError('Tab failed to initialize', MonitoringApi.APP_INITIALIZED))
        }),
      ),
      appEvents.pipe(
        filter(event => event.command === MonitoringApi.APP_READY),
        timeout({
          first: parseInt(config.get('service.appReadyEventTimeout'), 10),
          with: () => throwError(() => new TabCommunicationError('Tab failed to emit ready', MonitoringApi.APP_READY))
        }),
      ),
    ).pipe(
      take(1),
      ignoreElements()
    ),
    combineLatest([
      appEvents.pipe(
        filter(event => event.command === MonitoringApi.ONLINE),
      ),
      appEvents.pipe(
        filter(event => event.command === MonitoringApi.SOCKET_CONNECTION_CHANGE && event.body === 'connectionAccept'),
      ),
      appEvents.pipe(
        filter(event => event.command === MonitoringApi.MEDIA_CONNECTION_CHANGE && event.body === 'ONLINE'),
      )
    ]).pipe(
      take(1),
      timeout({
        first: parseInt(config.get('service.connectionStateTimeout'), 10),
        with: (() => throwError(() => new TabCommunicationError('Failed to connect', MonitoringApi.ONLINE)))
      }),
      switchMap(() => {
        let lastAliveEvent = '';
        return merge(
          appEvents.pipe(
            filter(event => event.command === MonitoringApi.ALIVE),
            tap(({command, timestamp, body}) => (
              lastAliveEvent = `${timestampToTime(timestamp)} ${command} ${JSON.stringify(body)}`
            )),
            timeout({
              each: parseInt(config.get('service.aliveEventTimeout'), 10), // add config for keep alive
              with: () => throwError(() => new TabCommunicationError('Tab stop sending alive',  MonitoringApi.ALIVE))
            }),
            catchError((error: TabCommunicationError) => {
              logger.error(`${timestampToTime()} ALIVE_SEND_TIMEOUT`);
              return throwError(() => error);
            }),
            finalize(() => logger.log(lastAliveEvent)),
            ignoreElements()
          ),
          of(undefined)
        );
      })
    ),
    appEvents.pipe(
      filter(event => event.command === MonitoringApi.APP_REFRESH),
      tap(() => {
        throw new AppRefreshError();
      }),
      ignoreElements()
    ),
  );
}
