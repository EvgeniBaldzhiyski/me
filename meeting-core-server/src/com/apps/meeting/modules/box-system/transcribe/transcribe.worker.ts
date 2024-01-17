import { BoxWorker } from '../utils/workers/box.worker';
import { TokenSet } from 'openid-client';
import config from 'config';
import { transcribeFactoryPromise } from '../../../../../tasks/worker-factory';

export class TranscribeWorker extends BoxWorker {
  protected setup() {
    this.maxStartingAttempts = config.get<number>('boxSystem.transcribe.maxStartingAttempts');
    this.startTimeout = config.get<number>('boxSystem.transcribe.startTimeout') * 1000;

    this.maxRabbitmqInitFailedAttempts = config.get<number>('boxSystem.transcribe.maxRabbitmqInitFailedAttempts');
    this.rabbitmqRetryInterval = config.get<number>('boxSystem.transcribe.rabbitmqRetryInterval') * 1000;

    this.maxTokenGenerationFailedAttempts = config.get<number>('boxSystem.transcribe.maxTokenGenerationFailedAttempts');
    this.tokenGenerationRetryInterval = config.get<number>('boxSystem.transcribe.tokenGenerationRetryInterval') * 1000;

    this.maxWorkerFailedAttempts = config.get<number>('boxSystem.transcribe.maxWorkerFailedAttempts');

    super.setup();
  }

  protected getUrlParams(token: TokenSet['access_token']) {
    return {
      mid: this.inst.model.meetingID,
      aid: this.inst.model.sessionSettings.hostID,
      rid: this.id,
      mode: 'transcribe',
      id_token: token,
      debug: '1'
    };
  }

  protected getRabbitMQConnectionFactory() {
    return transcribeFactoryPromise;
  }
}
