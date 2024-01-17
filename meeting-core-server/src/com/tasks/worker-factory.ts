import config from 'config';
import serverConfig from '../utils/serverConfig';
import { TaskQueueOptions } from '@container/task-queue/queue';
import { RemoteWorkerFactory } from '@container/task-queue';

export const workerFactoryCreator = (queueOptions: TaskQueueOptions, prefix: string) => {
  const publisher = new RemoteWorkerFactory({
    hostname: serverConfig.CONFIG.rabbitmq.hostname,
    username: serverConfig.CONFIG.rabbitmq.username,
    password: serverConfig.CONFIG.rabbitmq.password,
    port: serverConfig.CONFIG.rabbitmq.port
  }, queueOptions, `${prefix}_`);

  process.on('beforeExit', async () => publisher && await publisher.stop());

  return publisher;
};

export const mixerFactoryPromise = workerFactoryCreator(
  {
    exchangeName: serverConfig.CONFIG.audioMixerWorkerConfig.exchangeName,
    queueName: serverConfig.CONFIG.audioMixerWorkerConfig.queueName,
    routingKey: serverConfig.CONFIG.audioMixerWorkerConfig.routingKey
  },
  'MIXER'
);
export const pwrRecFactoryPromise = workerFactoryCreator(
  {
    exchangeName: serverConfig.CONFIG.pwrWorkerConfig.exchangeName,
    queueName: serverConfig.CONFIG.pwrWorkerConfig.queueName,
    routingKey: serverConfig.CONFIG.pwrWorkerConfig.routingKey
  },
  'FFMPEG_PWR'
);

export const transcribeFactoryPromise = workerFactoryCreator(
  {
    exchangeName: config.get('boxSystem.transcribe.exchangeName'),
    queueName: config.get('boxSystem.transcribe.queueName'),
    routingKey: config.get('boxSystem.transcribe.routingKey')
  },
  'TS'
);

export const voiceFactoryPromise = workerFactoryCreator(
  {
    exchangeName: config.get('boxSystem.voice.exchangeName'),
    queueName: config.get('boxSystem.voice.queueName'),
    routingKey: config.get('boxSystem.voice.routingKey')
  },
  'VB'
);

export const ssrFactoryPromise = workerFactoryCreator(
  {
    exchangeName: config.get('boxSystem.ssr.exchangeName'),
    queueName: config.get('boxSystem.ssr.queueName'),
    routingKey: config.get('boxSystem.ssr.routingKey')
  },
  'SSR'
);
