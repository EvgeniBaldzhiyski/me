import winston, { createLogger, transports } from 'winston';
import config from 'config';

export const auditLogger = createLogger({
  defaultMeta: {
    logger: 'audit'
  },
  silent: !config.get('auditLog'),
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new transports.Console()]
});
