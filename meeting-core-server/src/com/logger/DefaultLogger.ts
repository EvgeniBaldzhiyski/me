import apm from 'elastic-apm-node/start';
import { TransformableInfo } from 'logform';
import { createLogger, format, transports } from 'winston';
import { MESSAGE, LEVEL, SPLAT } from 'triple-beam';
import serverConfig from '../utils/serverConfig';
import { inspect } from 'util';

/**
 * function replacer (key, value)
 * Handles proper stringification of Buffer and bigint output.
 * @see https://github.com/winstonjs/logform/blob/master/json.js
 */
function replacer(key, value) {
  if (value instanceof Buffer) {
    return value.toString('base64');
  }
  // tslint:disable-next-line:typeof-compare
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value && value.isAxiosError) {
    value = {
      ...value,
      request: undefined,
      response: {
        ...value.response,
        request: undefined,
        config: undefined
      }
    };
    return value;
  }
  if (value instanceof Error) {
    return value.stack;
  }
  return value;
}

/**
 Transformer function to transform log data as provided by winston into
 a message structure which is more appropriate for indexing in ES.
 @link https://github.com/vanthome/winston-elasticsearch/blob/master/transformer.js
 @param {Object} logData
 @param {Object} logData.message - the log message
 @param {Object} logData.level - the log level
 @param {Object} logData.meta - the log meta data (JSON object)
 @returns {Object} transformed message
 */
function transformerElasticApm(logData: TransformableInfo): TransformableInfo | boolean {
  return Object.assign(
    {},
    logData,
    {message: logData?.message, timestamp: logData?.timestamp || new Date().toISOString()},
    logData?.stack ? {stack: logData.stack} : {},
    apm.currentTraceIds,
    {toJSON: undefined}
  );
}

function printfWithRestInJson() {
  return format.printf(
    (
      {level, message, timestamp, application, session, stack, [LEVEL]: _l, [MESSAGE]: _m, [SPLAT]: _s, ...meta}: TransformableInfo
    ): string => {
      return `${timestamp} ${level.toUpperCase()} ${application} ${session} : ${message}`
        + (meta && Object.values(meta).length ? ' ' + inspect(meta, false, 3) : '')
        + (stack ? '\nstack: ' + stack : '');
    }
  );
}


export function createDefaultLogger(
  name: string,
  subname: string,
  logLevel = serverConfig.CONFIG.logLevel || 'debug',
  logFormat = serverConfig.CONFIG.logFormat || 'plain'
) {
  return createLogger({
    defaultMeta: {
      application: name,
      session: subname,
    },
    level: logLevel,
    format: format.combine(
      ...([
        format(transformerElasticApm)(),
        logFormat === 'plain' && printfWithRestInJson(),
        logFormat === 'json' && format.json({space: 0, replacer})
      ]).filter(v => !!v)
    ),
    transports: [new transports.Console()]
  });
}
