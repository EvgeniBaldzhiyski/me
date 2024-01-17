import apm from 'elastic-apm-node/start';
import serverConfig from './serverConfig';
import { ErrorCodes } from '@container/models';
import Server, { ApiParserError, ServerRequest, ServerResponse } from './Server';
import { getValidInstance, parseUrl } from './server-input-utils';
// @todo here it is used a internal resource. Move it to be global
import { ServiceRegistry } from '../apps/service-registrar/service-registry';

export async function httpInput(server: Server, req: ServerRequest & {ip?: string}, res: ServerResponse, type: 'get' | 'post', next: Function) {
  try {
    const { appAlias, instAlias, endpointName, params } = parseUrl(req.url);
    const instance = await getValidInstance(server, appAlias, instAlias, params);

    server.logger.debug(`Receive REST call ${req.ip} ${type.toUpperCase()} ${req.url}`, {params: req.params});

    req.params = Object.assign(params || {}, req.params);

    if (instance.app.runId) {
      res.header('X-ACTIVE-MEETING-ID', instance.app.runId);
    }

    res.header('X-ACTIVE-MEETING-RUN-ID', instance.app.name);
    res.header('X-ACTIVE-MEETING-SERVICE-INSTANCE', ServiceRegistry.getMeetingServiceInstance);
    res.header('X-ACTIVE-MEETING-SERVICE-NAME', ServiceRegistry.getMeetingServiceName);
    res.header('X-ACTIVE-MEETING-SERVICE-RUN-ID', ServiceRegistry.getMeetingServiceRunID);
    res.header('X-ACTIVE-MEETING-SERVICE-INSTANCE-RUN-ID', ServiceRegistry.getMeetingServiceInstanceRunID);
    res.header('X-ACTIVE-MEETING-SERVICE-IPV4', await ServiceRegistry.getMeetingServiceIP());


    const handler = instance[type][endpointName];

    if (!handler) {
      throw new ApiParserError(`Method "${type.toUpperCase()} ${endpointName}" does not exist`, ErrorCodes.BAD_PARAMS);
    }

    server.logger.info(`Going to execute REST handler for endpoint ${type}:${endpointName}...`);
    await handler.call(instance.app, req, res, req.params, params.grants);
  } catch (err) {

    apm.captureError(err, {
      custom: {
        url: req.url,
        headers: JSON.stringify(req.headers)
      }
    });
    server.logger.error(err.message);

    if (serverConfig.CONFIG.sut.enabled) {
      res.send(err.code || ErrorCodes.FORBIDDEN, {
        errno: err.code || ErrorCodes.FORBIDDEN,
        message: err.message,
        stack: err.stack
      });
    } else {
      res.send(err.code ? err.code : ErrorCodes.FORBIDDEN, {
        errno: err.code ? err.code : ErrorCodes.FORBIDDEN,
        message: 'Internal server error'
      });
    }

    res.end();
  }

  return next();
}
