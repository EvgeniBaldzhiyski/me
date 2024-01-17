import { BoxWorker } from '../utils/workers/box.worker';
import { TokenSet } from 'openid-client';
import config from 'config';
import { voiceFactoryPromise } from '../../../../../tasks/worker-factory';

export class VoiceWorker extends BoxWorker {
  protected setup() {
    this.maxStartingAttempts = config.get<number>('boxSystem.voice.maxStartingAttempts');
    this.startTimeout = config.get<number>('boxSystem.voice.startTimeout') * 1000;

    this.maxRabbitmqInitFailedAttempts = config.get<number>('boxSystem.voice.maxRabbitmqInitFailedAttempts');
    this.rabbitmqRetryInterval = config.get<number>('boxSystem.voice.rabbitmqRetryInterval') * 1000;

    this.maxTokenGenerationFailedAttempts = config.get<number>('boxSystem.voice.maxTokenGenerationFailedAttempts');
    this.tokenGenerationRetryInterval = config.get<number>('boxSystem.voice.tokenGenerationRetryInterval') * 1000;

    this.maxWorkerFailedAttempts = config.get<number>('boxSystem.voice.maxWorkerFailedAttempts');

    super.setup();
  }

  protected getUrlParams(token: TokenSet['access_token']) {
    return {
      mid: this.inst.model.meetingID,
      aid: this.inst.model.sessionSettings.hostID,
      rid: this.id,
      mode: 'mixer',
      id_token: token,
      debug: '1'
    };
  }

  protected getRabbitMQConnectionFactory() {
    return voiceFactoryPromise;
  }
}
