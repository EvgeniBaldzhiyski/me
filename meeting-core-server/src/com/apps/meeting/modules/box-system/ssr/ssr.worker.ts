import { BoxWorker } from '../utils/workers/box.worker';
import { TokenSet } from 'openid-client';
import config from 'config';
import { ssrFactoryPromise } from '../../../../../tasks/worker-factory';
import { SsrWorkerPayload, SsrWorkerStartTaskQueuePac } from './ssr.worker.interface';
import { SsrWorkerState } from '@container/models';

export class SsrWorker extends BoxWorker<SsrWorkerPayload, SsrWorkerState> {
  protected setup() {
    this.maxStartingAttempts = config.get<number>('boxSystem.ssr.maxStartingAttempts');
    this.startTimeout = config.get<number>('boxSystem.ssr.startTimeout') * 1000;

    this.maxRabbitmqInitFailedAttempts = config.get<number>('boxSystem.ssr.maxRabbitmqInitFailedAttempts');
    this.rabbitmqRetryInterval = config.get<number>('boxSystem.ssr.rabbitmqRetryInterval') * 1000;

    this.maxTokenGenerationFailedAttempts = config.get<number>('boxSystem.ssr.maxTokenGenerationFailedAttempts');
    this.tokenGenerationRetryInterval = config.get<number>('boxSystem.ssr.tokenGenerationRetryInterval') * 1000;

    this.maxWorkerFailedAttempts = config.get<number>('boxSystem.ssr.maxWorkerFailedAttempts');

    super.setup({title: this.payload.title});
  }

  protected getUrlParams(token: TokenSet['access_token']) {
    return {
      mid: this.inst.model.meetingID,
      aid: this.inst.model.sessionSettings.hostID,
      rid: this.id,
      mode: 'ssr',
      id_token: token,
      debug: '1',
      brand: this.inst.model.sessionSettings.brand
    };
  }

  protected createTaskQueueStartPack(url: string): SsrWorkerStartTaskQueuePac {
    return {
      cid: this.inst.model.sessionSettings.companyId,
      mid: this.inst.model.meetingID,
      mrunid: this.inst.model.meetingRunID,
      url,
      aid: this.payload.aid,
      rid: this.id,
      meetingName: this.inst.model.sessionSettings.name.trim(),
      title: this.payload.title.trim(),
      playlistId: this.payload.playlistId
    };
  }

  protected getRabbitMQConnectionFactory() {
    return ssrFactoryPromise;
  }
}
