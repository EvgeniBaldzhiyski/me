import { RemoteWorker, WorkerMessage, WorkerStatus } from '@container/task-queue';
import { ApmSpan } from '@container/apm-utils';
import BaseModule from '../BaseModule';
import Meeting from '../../Meeting';
import { ExportingStatusMessage, ExportingStatusMessagesMap } from './ExportingStatusMessages';
import { Subject } from 'rxjs';
import { debounceTime, filter, tap } from 'rxjs/operators';

export default class ExportingEngine extends BaseModule {

  private exportStatus$: Subject<ExportingStatusMessage> = new Subject();

  private onExportStatusSubscription = this.exportStatus$.pipe(
    tap(({ method, message, type }) => this.inst.roomEngine.sendToMainPresenters(method, { message, type })),
    filter(({ type }) => type === 'warn'),
    debounceTime(2000)
  ).subscribe(data => {
    this.inst.assetsEngine.loadAssets('');
  });

  constructor(protected inst: Meeting) {
    super(inst);
  }

  destruct() {
    this.exportStatus$.unsubscribe();
    this.exportStatus$ = undefined;
    this.onExportStatusSubscription.unsubscribe();
    this.onExportStatusSubscription = undefined;
    return super.destruct();
  }


  isJobDone(workerMessage: WorkerMessage): boolean {
    return (
      workerMessage.payload
      && workerMessage.payload.status
      && workerMessage.payload.status.startsWith('EXPORTED_')
    );
  }

  isJobFailed(workerMessage: WorkerMessage): boolean {
    return workerMessage.status === WorkerStatus.FAILED || (
      workerMessage.payload
      && workerMessage.payload.status
      && workerMessage.payload.status.startsWith('ERROR_')
    );
  }

  /**
   * cleanStopWorker
   * A helper function that stops a PDF worker and cleans up its resources.
   *
   * @param {WorkerMessage} message
   * @param {RemoteWorker} worker
   * return {Promise<boolean>}
   */
  @ApmSpan()
  cleanStopWorkerOnDoneMessage(message: WorkerMessage, worker: RemoteWorker): Promise<boolean> {
    if (message.status !== WorkerStatus.DONE) {
      return Promise.resolve(false);
    }

    worker.observer.removeAllListeners('message');
    return worker.shutdown().then(() => true);
  }

  /**
   * sendWorkerStatusToAttendee
   * Converts a pdf worker status code to human-friendly text message and sends it to the UI.
   *
   * @param {ObjectConstructor} workerStatusCode
   * @param {string} roomName
   * @return {void}
   */
  @ApmSpan()
  sendWorkerStatusToAttendee(workerMessage: WorkerMessage, roomName: string  = ''): void {
    let workerStatusCode: keyof typeof ExportingStatusMessagesMap;

    if (workerMessage.payload && workerMessage.payload.error) {
      workerStatusCode = workerMessage.payload.error;
    } else if (workerMessage.payload && workerMessage.payload.status) {
      workerStatusCode = workerMessage.payload.status;
    } else {
      // we are not interested in generic status messages, such as "working".
      return;
    }

    this.publishExportStatus(workerStatusCode, roomName);
  }

  /**
   * sendPdfDisabledMessage
   * A shortcut function for notifying the users PDF setting is disabled.
   *
   * @param {string} roomName
   * @return {void}
   */
  @ApmSpan()
  sendPdfDisabledMessage(roomName: string = '', customMessageCode: keyof typeof ExportingStatusMessagesMap = 'PDF_DISABLED') {
    this.publishExportStatus(customMessageCode, roomName);
  }

  /**
   * Publishes export status to the internal observable, which triggers side effects
   *
   * @param statusCode
   * @param roomName
   */
  @ApmSpan()
  publishExportStatus(statusCode: keyof typeof ExportingStatusMessagesMap, roomName: string = '') {
    const transformerFn = ExportingStatusMessagesMap[statusCode];
    let exportStatus = transformerFn && transformerFn(roomName);
    if (!exportStatus) {
      this.inst.logger.warn(`Trying to publish unknown PDF export message code "${statusCode}". Falling back to UNKNOWN_ERROR.`);
      exportStatus = ExportingStatusMessagesMap['UNKNOWN_ERROR']();
    }

    this.exportStatus$.next(exportStatus);
  }

  /**
   * Returns a message code when PDF export in a given room is unnecessary.
   *
   * @param {string} roomId
   * @return {string}
   */
  @ApmSpan()
  getNothingToExportMessage(roomId: string): 'ROOM_NOT_FOUND' | 'ROOM_EMPTY' | 'PDF_DISABLED_PER_ROOM' | '' {
    const room = this.inst.roomEngine.getRoomById(roomId);

    if (!room) {
      return 'ROOM_NOT_FOUND';
    }

    if (!room.hasBeenUsed) {
      return 'ROOM_EMPTY';
    }

    if (!room.saveAsPdf.chat && !room.saveAsPdf.notes && !room.saveAsPdf.whiteboard) {
      return 'PDF_DISABLED_PER_ROOM';
    }

    return '';
  }
}
