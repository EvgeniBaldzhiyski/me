const { Kafka } = require('kafkajs');
import config from 'config';
import apm from 'elastic-apm-node/start';
import fs from 'fs';
import { processLogger } from './processLogger';
import { FAEvent } from '../apps/meeting/kafka/fa-event-types';
import { Attendee, BotsRolesList, Roles } from '@container/models';
import { defer, EMPTY, from, of, Subscription } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';

const _config = config.get('kafka') as {
  clientId: string,
  topicsPrefix: string,
  connectionTimeout: number,
  authenticationTimeout: number,
  reauthenticationThreshold: number,
  bootstrapServers: string,
  ssl: {
    enabled: boolean,
    rejectUnauthorized: boolean,
    caPath: string
  },
  auth: {
    userCertPath: string,
    userKey: string
  }
};
const kConfig = {
  ..._config,
  brokers: _config.bootstrapServers.split(','),
  ssl: {
    rejectUnauthorized: _config.ssl.rejectUnauthorized,
    ca: [fs.readFileSync(_config.ssl.caPath, 'utf-8')],
    key: fs.readFileSync(_config.auth.userKey, 'utf-8'),
    cert: fs.readFileSync(_config.auth.userCertPath, 'utf-8')
  }
};
const kafka = new Kafka(kConfig);
const producer = kafka.producer();

async function kafkaPublish(key: string, value: string, topic: string): Promise<void> {
  await producer.connect();
  await producer.send({
    topic,
    messages:
      [{
        key,
        value
      }]
  });
}

export function publishKafkaEvent(event: FAEvent, kafkaKey: string, attendeeRole?: Attendee['role']): Subscription {
  return defer(() => {
    const eventJSON = JSON.stringify(event);

    if (attendeeRole && attendeeRole === Roles.GHOST) {
      processLogger.debug(
        `Event log is skipping log for a Bot, an event with payload ${eventJSON} was going to be published. Response: n/a`
      );
      return;
    }

    if (!event.isValid()) {
      processLogger.debug(`Event log is skipping log for not valid properties, an event with payload ${eventJSON} was going to be published. Response: n/a`);
      return;
    }

    const topic = event.getKafkaTopic(config.get('kafka.topicsPrefix'));

    if (!config.get('enableKafkaLog')) {
      processLogger.debug(`Kafka event log is disabled, an event with payload '${eventJSON}' and topic '${topic}' was going to be published. Response: n/a`);
      return;
    }
    return of({ topic, eventJSON });
  }).pipe(
    catchError(err => {
      apm.captureError(err);
      processLogger.error(`Failed to serialize Kafka event. error: ${err.message}`);
      return EMPTY;
    }),
    switchMap(({ topic, eventJSON }) => from(kafkaPublish(kafkaKey, eventJSON, topic)).pipe(
      tap(_ => {
        processLogger.debug(`Success publishing event to Kafka. KTopic: ${topic}. KKey: ${kafkaKey}. KValue: ${eventJSON}`);
      }),
      catchError(err => {
        apm.captureError(err);
        processLogger.error(`Failed publishing event to Kafka. error: ${err.message}. KTopic: ${topic}. KKey: ${kafkaKey}. KValue: ${eventJSON}`);
        return EMPTY;
      })
    ))
  ).subscribe();
}

export async function terminateKafka() {
  processLogger.info(`Disconnecting Kafka publisher...`);
  try {
    await producer.disconnect();
  } catch (ex) {
    apm.captureError(ex);
    processLogger.error(`Failed to disconnect Kafka producer:${ex.message}`, 'shutdown');
  } finally {
    processLogger.info('Kafka publisher has been disconnected', 'shutdown');
  }
}
