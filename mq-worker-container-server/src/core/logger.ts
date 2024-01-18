/* eslint-disable @typescript-eslint/no-explicit-any */
import config from 'config';
import apm from 'elastic-apm-node/start';
import ContextError from './context-error';
import { format, createLogger, transports, Logger as WinstonLogger } from 'winston';
import { v4 } from 'uuid';

(console as any)._stdout = process.stdout;
(console as any)._stderr = process.stderr;

export type LogContext = {[key: string]: string; context?: string} | string;

class Logger {
  private static DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ss';
  private static LOG_TYPE_JSON = 'json';

  readonly level: string;

  traceId = '';
  transactionId = '';
  referenceId = '';

  private spanIds = '';

  private logger: WinstonLogger;

  constructor() {
    this.level = config.get('service.logLevel');

    const logType = config.has('service.logType') ?
      (config.get('service.logType') as string).toLowerCase() : Logger.LOG_TYPE_JSON;

    if (logType !== Logger.LOG_TYPE_JSON) {
      this.logger = createLogger({
        level: config.get('service.logLevel'),
        format: format.combine(
          format.timestamp({
            format: Logger.DATE_FORMAT
          }),
          format.printf((info: {[key: string]: unknown; level: string; message: string}) => Logger.displayFormat(info))
        ),
        transports: [
          new transports.Console()
        ]
      });
    } else {
      const additionalJsonProperties = format(info => {
        info.severity = info.level.toUpperCase();
        info.service = config.get('service.name');
        info.pid = process.pid;
        info.podName = process.env.KUBERNETES_POD_NAME;

        info['trace.id'] = this.traceId;
        info['transaction.id'] = this.transactionId;
        info['span.id'] = this.spanIds;
        info['ref.id'] = this.referenceId;

        return info;
      });
      this.logger = createLogger({
        level: config.get('service.logLevel'),
        format: format.combine(
          additionalJsonProperties(),
          format.timestamp({
            format: Logger.DATE_FORMAT
          }),
          format.json()
        ),
        transports: [
          new transports.Console()
        ]
      });
    }
  }

  private static displayFormat(info: { [key: string]: unknown; level: string; message: string }) {
    return `${info.timestamp} ${info.level.toUpperCase()} ${info.message}`;
  }

  setSpanId(id: string) {
    this.spanIds += `${this.spanIds && '.'}${id}`;
  }

  removeSpanId(id?: string) {
    if (!id) {
      this.spanIds = '';
      return;
    }
    this.spanIds = this.spanIds.replace(new RegExp(`${id}\.?`), '');
  }

  debug(message: string, context?: any): void {
    this.logger.debug(message, {context});
  }

  log(message: string, context?: LogContext): void {
    this.logger.info(message, {context});
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, {context});
  }

  error(err: string | Error, context?: LogContext): void {
    if (typeof err === 'string') {
      err = new Error(err);
    }

    const _context = (typeof context === 'string' ? {context} : context);

    let _errContext: any = {};
    if (err instanceof ContextError) {
      _errContext = (typeof err.context === 'string' ? {errContext: err.context} : err.context);
    }

    const errId = v4();

    apm.captureError(err, {custom: {errId}});

    this.logger.error(`${err.message}`, {
      ..._context,
      ..._errContext,
      errId,
    });
  }
}

export default new Logger();
