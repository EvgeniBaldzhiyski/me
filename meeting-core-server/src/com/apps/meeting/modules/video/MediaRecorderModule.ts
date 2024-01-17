import apm from 'elastic-apm-node/start';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import { v4 } from 'uuid';
import BaseModule, { StateInterface } from '../BaseModule';
import {
  Attendee,
  ClientConnectionAPI,
  RestAPI,
  ServerConnectionAPI,
  PersonalMediaRecStatus,
  RecStartTaskQueuePac,
  CamState,
  StreamData,
  Roles,
  CameraStreamState,
  ErrorCodes
} from '@container/models';
import { PersonalRecordingController } from './MediaRecordController';
import { TaskStatus, TaskMessage } from '../../../../tasks/task-resources';
import { pwrRecFactoryPromise } from '../../../../tasks/worker-factory';
import { coreApi } from '../../../../utils/coreApiClient';
import { DB_COLLECTIONS, defaultDb } from '../../../../database';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import Client from '../../../../utils/Client';
import { publishKafkaEvent } from '../../../../utils/kafka-publisher';
import { CameraEvent, CameraEventPayload } from '../../kafka/fa-event-types';
import KafkaUtils from '../../kafka/kafka-utils';

const PersonalRecording = 'personal_recording';

export interface MediaRecordModuleState extends StateInterface {
  recorders: {
    id: Attendee['id'],
    title: string,
    initiatorId: Attendee['id']
    playlistID: string,
  }[];
}

class MediaItem {
  public playlistID = '';
  public videoId = '';
  public worker: PersonalRecordingController;
  public status: PersonalMediaRecStatus = PersonalMediaRecStatus.STOPPED;

  public startTime = 0;
  public retryCounter = 0;

  constructor(
    public id: Attendee['id'],
    public title: string,
    public initiatorId: Attendee['id']
  ) { }
}

export default class MediaRecorderModule extends BaseModule {
  private register: Record<Attendee['id'], MediaItem> = {};

  private tryAgainTimeout = 5000;
  private tryAgainMaxTries = 5;
  private tryAgainDelay = 3; // in sec

  protected stateCollection = defaultDb().collection(DB_COLLECTIONS.MEDIA_RECORD_MODULE_STATE);

  async setup () {
    await super.setup();

    this.inst.updateEngine.registerApprover(this);

    await this.loadState();

    return Promise.resolve();
  }

  @ApmSpan()
  async approveAttendeeChange(_, id, data, done) {
    await done(data);

    if (!this.inst.model.sessionSettings.allowPrivateRecording) {
      return;
    }

    const a = this.inst.model.attendeesIndex[id];
    const item: MediaItem = this.register[id];

    if (!a || !item || item.status === PersonalMediaRecStatus.STOPPED) {
      return;
    }


    if (data.room !== undefined) {
      const toRoom = this.inst.model.roomsIndex[a.room];
      this.pause(item);

      return;
    }

    if (data.kickedOut !== undefined) {
      this.stopRecord(item);
      return;
    }

    if (data.left || data.role === Roles.PHONE) {
      this.pause(item);
      return;
    }

    // Here it is OK to stop on button click for better user experience, instead of waiting for mediaserver
    // to tell us video producer is closed.
    if (data.camState === CamState.off) {
      if (item.status === PersonalMediaRecStatus.PUBLISHED) {
        this.pause(item);
      }
      if (item.status === PersonalMediaRecStatus.INIT) {
        this.stopRecord(item);
      }
      return;
    }
  }


  // Record only if there is a stream available. We can not simply check for camera state here, because
  // it only reflects a mouse click in the UI, not that mediaserver has started producing video
  @Socket(ServerConnectionAPI.CAMERA_STREAM_STATE)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private onVideoProducerChange({ id, state }: { id: Attendee['id'], state: CameraStreamState }) {
    const item = this.register[id];

    if (item && state === CameraStreamState.ACTIVE) {
      if (item.status === PersonalMediaRecStatus.PAUSED) {
        this.resume(item);
      } else if (item.status === PersonalMediaRecStatus.PUBLISHED) {
        // The attendee being recorded has reconnected to the media server so we stop the current personal recording
        // and start a new one so that we can capture the new video/audio streams
        this.pause(item);
        setTimeout(() => this._onVideoProducerChange(item), 2000);
      }
    }

    if (state === CameraStreamState.ACTIVE){
      const kEvent = this.createKafkaCameraEvent(id, state);
      publishKafkaEvent(kEvent, this.inst.model.meetingID);
    }
  }

  private createKafkaCameraEvent(attendeeId: Attendee['id'], state: CameraStreamState): CameraEvent {
    const eventName = state === CameraStreamState.ACTIVE ? 'StartCamera' : 'StopCamera';
    const payload: CameraEventPayload = {
      _id: v4(),
      ts: Date.now(),
      meeting: KafkaUtils.getMeetingCommonData(this.inst.model),
      attendee: KafkaUtils.getAttendeeCommonData(this.inst.model.attendeesIndex[attendeeId])
    };

    return new CameraEvent(eventName, payload);
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private _onVideoProducerChange(item: MediaItem) {
    this.resume(item);
  }

  private unauthorizedAccess(client, message: string) {
    return this.inst.logger.error(message, {
      clientData: client.data,
      clientIP: client.ip
    });
  }

  @ApmSpan()
  onRemoveAttendee(id: string) {
    const item = this.register[id];
    if (item) {
      this.stopRecord(item);
    }
  }

  @Socket(ServerConnectionAPI.PERSONAL_MEDIA_REC_START)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private start(@client client: Client, data: { recordedAttID: Attendee['id'], title: string }) {
    if (!this.inst.model.sessionSettings.allowPrivateRecording) {
      return this.unauthorizedAccess(client, 'Personal recording is not allowed - cmd(start)');
    }
    const sender = this.inst.model.attendeesIndex[client.data.aid];
    if (!sender.hasBaton) {
      return this.unauthorizedAccess(client, 'Unauthorized access to personal recording - cmd(start)');
    }
    const a = this.inst.model.attendeesIndex[data.recordedAttID];
    if (!a) {
      return this.unauthorizedAccess(client, `Recorder (${a.id}) cannot be started - target is missing`);
    }

    this.processBeginCommand(
      this.registerItem(a.id, data.title, sender.id)
    );
  }

  @ApmSpan()
  private resume(item: MediaItem) {
    this.processBeginCommand(item);
  }

  @Socket(ServerConnectionAPI.PERSONAL_MEDIA_REC_STOP)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private stop(@client client: Client, data: { recordedAttID: Attendee['id'], initiatorID: Attendee['id'] }) {
    if (!this.inst.model.sessionSettings.allowPrivateRecording) {
      return this.unauthorizedAccess(client, 'Personal recording is not allowed - cmd(start)');
    }
    const sender = this.inst.model.attendeesIndex[client.data.aid];
    if (!sender.hasBaton) {
      return this.unauthorizedAccess(client, 'Unauthorized access to personal recording - cmd(stop)');
    }
    const a = this.inst.model.attendeesIndex[data.recordedAttID];
    if (!a) {
      return this.unauthorizedAccess(client, `Recorder (${a.id}) cannot be stopped - target is missing`);
    }

    const item = this.register[a.id];

    if (item) {
      this.stopRecord(item);
    } else {
      this.inst.logger.debug(`Record item (${item.id}) is missing`, sender.id);
    }
  }

  @ApmSpan()
  private pause(item: MediaItem) {
    this.stopRecord(item, false);
  }

  @ApmSpan()
  private async processBeginCommand(item: MediaItem) {
    const a = this.inst.model.attendeesIndex[item.id];
    if (!a) {
      return this.inst.logger.error(`Recorder (${item.id}) cannot be processed`, {item});
    }

    try {
      await this.startRecord(item, a.room);
    } catch (err) {
      const custom = { attendeeId: a.id, videoId: item.id };
      apm.captureError(err, { custom });
      this.inst.logger.error(err.message, custom);

      if (item.status !== PersonalMediaRecStatus.STOPPED) {
        this.changeStatus(item.id, PersonalMediaRecStatus.STOPPED);
      }
      this.inst.sendToAttendee(item.initiatorId, ClientConnectionAPI.PERSONAL_MEDIA_REC_NOTIFICATION, item.id);

      try {
        await coreApi.post<void>(
          RestAPI.PERSONAL_RECORD_ERROR,
          {
            id: item.videoId
          }
        );
        this.inst.logger.debug(`.NET processed FFMPEG fail event for personal record ${item.videoId}`);
      } catch (error) {
        const custom = { attendeeId: a.id, videoId: item.id };
        apm.captureError(error, { custom });
        this.inst.logger.error(`.NET could not process FFMPEG fail event for personal record. ${error.message}`, custom);
      }
    }
  }

  @ApmSpan()
  private async startRecord(item: MediaItem, room?: string) {
    if (!item || item.status === PersonalMediaRecStatus.PUBLISHED || item.status === PersonalMediaRecStatus.INIT) {
      return;
    }

    const a = this.inst.model.attendeesIndex[item.id];

    item.videoId = v4();
    item.startTime = (new Date).getTime();

    const metadata: RecStartTaskQueuePac = {
      playlistID: item.playlistID,
      videoId: item.videoId,
      title: item.title || `Personal recording - ${a.fullName}`,
      owner: item.initiatorId,
      mid: this.inst.model.meetingID
    };

    const streamData: StreamData = {
      mrid: `${this.inst.model.meetingID}${room ? '_' + room : ''}`,
      attId: item.id,
      workType: PersonalRecording
    };

    const recWorkerFactory = pwrRecFactoryPromise;
    try {
      await recWorkerFactory.start();
    } catch (error) {
      apm.captureError(error);
      this.inst.logger.error(error.message);
      return;
    }

    item.worker = new PersonalRecordingController(
      recWorkerFactory,
      item.id,
      { streamData, metadata },
      this.inst.logger
    );

    this.changeStatus(item.id, PersonalMediaRecStatus.INIT);

    item.worker.observer.on('message', this._onChangeStatus);
    item.worker.start();

    this.inst.logger.info(`Start personal recording for attendee ${item.id}`);
  }

  @ApmSpan()
  private stopRecord(item: MediaItem, done = true) {
    if (!item || item.status === PersonalMediaRecStatus.STOPPED) {
      return;
    }

    if (item.worker) {
      item.worker.observer.removeListener('message', this._onChangeStatus);
      item.worker.stop();
    }
    item.worker = null;

    this.changeStatus(item.id, (done ? PersonalMediaRecStatus.STOPPED : PersonalMediaRecStatus.PAUSED));

    this.inst.logger.info(`Stop personal recording for attendee ${item.id}`);
  }

  private _onChangeStatus = (data: TaskMessage) => {
    this._changeStatus(data);
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private _changeStatus(data: TaskMessage) {
    this.inst.logger.debug(`Personal media recording status changed.`, data);

    const item: MediaItem = this.register[data.jobId];
    if (!item) {
      return;
    }

    switch (data.status) {
      case TaskStatus.WORKING:
        this.changeStatus(item.id, PersonalMediaRecStatus.PUBLISHED);
        break;
      case TaskStatus.DONE:
        this.changeStatus(item.id, PersonalMediaRecStatus.PAUSED);
        break;
      case TaskStatus.FAILED:
        if (item.status === PersonalMediaRecStatus.STOPPED) {
          return;
        }
        const now = (new Date).getTime();
        if (now - item.startTime > this.tryAgainDelay * 1000) {
          item.retryCounter = 0;
        }

        if (item.retryCounter < this.tryAgainMaxTries) {
          this.changeStatus(item.id, PersonalMediaRecStatus.INIT);

          item.retryCounter++;

          setTimeout(() => this.tryAgainDelayCallback(data), this.tryAgainTimeout);
        } else {
          this.changeStatus(item.id, PersonalMediaRecStatus.STOPPED);
          this.inst.sendToAttendee(item.initiatorId, ClientConnectionAPI.PERSONAL_MEDIA_REC_NOTIFICATION, item.id);
        }
        break;
    }
  }

  @ApmTransaction(TransactionType.RPC_REQUEST)
  private tryAgainDelayCallback(data) {
    this.tryAgain(data.jobId);
  }

  @ApmSpan()
  private tryAgain(id) {
    const item: MediaItem = this.register[id];
    if (!item || item.status === PersonalMediaRecStatus.STOPPED) {
      return;
    }
    // change status to avoid return
    item.status = PersonalMediaRecStatus.PAUSED;

    this.processBeginCommand(item);
  }

  @ApmSpan()
  private changeStatus(id, status: PersonalMediaRecStatus) {
    const item = this.register[id];
    if (!item) {
      return;
    }

    if (item.status !== status) {
      item.status = status;
      this.inst.updateEngine.updateAttendee(null, id, { personalMediaRecStatus: item.status });
    }
  }

  private registerItem(attId: Attendee['id'], title: string, initiatorId: Attendee['id']) {
    this.register[attId] = new MediaItem(attId, title, initiatorId);
    this.register[attId].playlistID = v4();

    return this.register[attId];
  }

  async beforeDestruct(code) {
    if (code === ErrorCodes.SERVER_RESTART) {
      await this.saveState();
    }

    for (const item of Object.values(this.register)) {
      if (item.status !== PersonalMediaRecStatus.STOPPED) {
        if (code === ErrorCodes.SERVER_RESTART) {
          this.pause(item);
        } else {
          this.stopRecord(item);
        }
      }
    }

    this.register = {};

    return super.beforeDestruct(code);
  }

  @ApmSpan()
  protected populateState({ recorders }: MediaRecordModuleState) {
    for (const { id, title, initiatorId, playlistID } of recorders) {
      const item = this.registerItem(id, title, initiatorId);

      item.playlistID = playlistID;
      item.status = PersonalMediaRecStatus.PAUSED;

      const attendee = this.inst.model.attendeesIndex[item.id];

      if (attendee) {
        this.inst.updateEngine.approveAndApplyData(null, { id: item.id, data: { personalMediaRecStatus: item.status }} );
      }
    }
  }

  @ApmSpan()
  protected serializeState(): MediaRecordModuleState | null {
    const recorders = Object.values(
      this.register
    ).filter(
      ({ status }) => status !== PersonalMediaRecStatus.STOPPED
    ).map(({ id, title, initiatorId, playlistID }) => ({
      id,
      title,
      initiatorId,
      playlistID
    }));

    return recorders.length ? { recorders } : null;
  }
}
