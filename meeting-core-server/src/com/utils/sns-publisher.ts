import { config as SNSConfig, SNS } from 'aws-sdk';
import config from 'config';
import { MessageAttributeMap } from 'aws-sdk/clients/sns';

const snsOptions = config.get('sns') as {
  awsConfig: object,
  options: object,
  topicArn: string,
};
SNSConfig.update({ ...snsOptions.awsConfig, maxRetries: 3 });

const sns = new SNS(snsOptions.options);

export async function snsPublish(message: string, messageAttributes?: MessageAttributeMap) {
  return sns.publish({
      TopicArn: snsOptions.topicArn,
      Message: message,
      MessageAttributes: messageAttributes
    })
    .promise();
}
