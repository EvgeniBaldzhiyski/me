import {
  Kafka,
  KafkaConfig,
  Message,
  Producer,
  ProducerRecord,
  RecordMetadata
} from 'kafkajs';
import config from 'config';
import { TranscribeActionMessage } from './fa-event-types';
import { catchError, from, lastValueFrom, Observable, of, switchMap, tap } from 'rxjs';
import logger from '../core/logger';
import apm from 'elastic-apm-node/start';
import fs from 'fs';
import { Payload } from '../services/utils/payload';

export interface KafkaInternalConfig extends KafkaConfig {
  clientId: string;
  topicsPrefix: string;
  connectionTimeout: number;
  authenticationTimeout: number;
  reauthenticationThreshold: number;
  bootstrapServers: string;
  ssl: {
    enabled: boolean;
    rejectUnauthorized: boolean;
    caPath: string;
  };
  auth: {
    userCertPath: string;
    userKey: string;
  };
}

export interface InternalProducer {
  send(key: string, message: TranscribeActionMessage): Observable<RecordMetadata[]>;
  sendSync(key: string, message: TranscribeActionMessage): void;
  shutdown(): Promise<void>;
}

export class KafkaProducer implements InternalProducer {
  private producer: Producer;
  private isConnecting: Promise<void>;

  constructor(kafkaConfig: KafkaConfig) {
    this.producer = this.createProducer(kafkaConfig);
  }

  public sendSync(key: Payload['mid'], message: TranscribeActionMessage): void {
    void lastValueFrom<RecordMetadata[]>(this.send(key, message));
  }

  public send(key: Payload['mid'], message: TranscribeActionMessage): Observable<RecordMetadata[]> {
    const kafkaTopic = message.getKafkaTopic();
    let eventJSON = '';
    try {
      eventJSON = JSON.stringify(message);
    } catch (err) {
      logger.error(`Failed serializing event for Kafka. error: ${err.message}. KTopic: ${kafkaTopic}. KKey: ${key}. KValue: ${message}`);
      return of([] as RecordMetadata[]);
    }

    const kafkaMessage: Message = {
      key,
      value: eventJSON
    };

    const topicMessage: ProducerRecord = {
      topic: kafkaTopic,
      messages: [kafkaMessage]
    };

    return from(this.start()).pipe(
      switchMap(() => from(this.producer.send(topicMessage))),
      tap(() => {
        logger.debug(`Success publishing event to Kafka. KTopic: ${kafkaTopic}. KKey: ${key}. KValue: ${eventJSON}`);
      }),
      catchError(err => {
        apm.captureError(err);
        logger.error(`Failed publishing event to Kafka. error: ${err.message}. KTopic: ${kafkaTopic}. KKey: ${key}. KValue: ${eventJSON}`);
        return of([] as RecordMetadata[]);
      })
    );
  }

  public shutdown(): Promise<void> {
    return this.producer.disconnect();
  }

  private start(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    if (!this.isConnecting) {
      this.isConnecting = this.producer.connect();
    }

    return this.isConnecting;
  }

  private createProducer(kafkaConfig: KafkaConfig): Producer {
    const kafka = new Kafka(kafkaConfig);
    return kafka.producer();
  }
}

export const kafkaProducerFactory = (kafkaConfig: KafkaConfig): InternalProducer => {
  if (!config.get('enableKafkaLog')) {
    return {
      sendSync: (key: Payload['mid'], message: TranscribeActionMessage): void => {
        logger.debug(`Kafka event log is disabled, an event with payload '${JSON.stringify(message)}'
        and topic '${message.getKafkaTopic()}' was going to be published. Response: n/a`);
      },
      send: (key: string, message: TranscribeActionMessage): Observable<RecordMetadata[]> => {
        logger.debug(`Kafka event log is disabled, an event with payload '${JSON.stringify(message)}'
        and topic '${message.getKafkaTopic()}' was going to be published. Response: n/a`);
        return of([] as RecordMetadata[]);
      },
      shutdown: (): Promise<void> => Promise.resolve()
    } as InternalProducer;
  }

  return new KafkaProducer(kafkaConfig);
};

const _config = config.get('kafka') as KafkaInternalConfig;

const kConfig: KafkaConfig = {
  ..._config,
  brokers: _config.bootstrapServers.split(','),
  ssl: {
    rejectUnauthorized: _config.ssl.rejectUnauthorized,
    ca: [fs.readFileSync(_config.ssl.caPath, 'utf-8')],
    key: fs.readFileSync(_config.auth.userKey, 'utf-8'),
    cert: fs.readFileSync(_config.auth.userCertPath, 'utf-8')
  }
};

export const kafkaProducer: InternalProducer = kafkaProducerFactory(kConfig);
