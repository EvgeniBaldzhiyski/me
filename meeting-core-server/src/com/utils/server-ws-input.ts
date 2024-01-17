import WebSocket from 'ws';
import apm from 'elastic-apm-node/start';
import {ServerClient, ServerClientInterface, ServerSocketIoClient} from './ServerClient';
import serverConfig from './serverConfig';
import AppInstance from './AppInstance';
import Server, { ApiParserError } from './Server';
import { IncomingMessage } from 'http';
import { ErrorCodes, MessagePackage, ServerConnectionAPI } from '@container/models';
import { getValidInstance, parseUrl } from './server-input-utils';
import { ApplicationInterface, ApplicationLifeCycleState } from './Application';
import { AuthJwtFromRequest, authJwt } from '../gateway/manager';
import { AuthPayload } from '../gateway/types';
import { auditLogger } from '../logger/AuditLogger';
import { Socket } from 'socket.io';

export function disconnectClient(server: Server, instance: AppInstance<ApplicationInterface>, client: ServerClientInterface) {
  instance.removeClient(client.id);

  // NOTE: It could happen that the Application is shutting down or shutdown already
  //       and Clients are only then closing their Connections,
  //       so it doesn't make sense to schedule again a shutdown.
  //       In the same time if it happens that a Connection have closed
  //       during Initialization or Running stage,
  //       we would definitely want to let the Application know about it.
  if (instance.app.isClosed()) {
    return;
  }

  const l = instance.clientsLength;
  if (l === 0) {
    // Initiate Shutdown Timer that runs asynchronously on purpose of server scope
    void server.shutdownInst(instance.id);
  }
  server.logger.debug(`client (${client.id}) has been removed (${l})`);

  try {
    instance.app.onDisconnect(client.client);
  } catch (err) {
    apm.captureError(err);
    server.logger.error(err.message);
  }
}

export function setConnectionApi(
  server: Server,
  connection: WebSocket | Socket,
  instance: AppInstance<ApplicationInterface>,
  client: ServerClientInterface,
  req: IncomingMessage
) {
  connection.on('error', err => {
    // keep the handler here to avoid unhandled errors and thus NodeJS process exits,
    // but do nothing more than logging as the connection is closed almost immediately after error
    // where the Client is disconnected and that is they way we handle these errors for now :(
    // ```
    // If an EventEmitter does not have at least one listener registered for the 'error' event,
    // and an 'error' event is emitted, the error is thrown,
    // a stack trace is printed, and the Node.js process exits.
    // ```
    // @see https://nodejs.org/api/events.html#events_error_events
    //
    server.logger.debug(err);
  });

  connection.on('close', _ => {
    connection.removeAllListeners();
    disconnectClient(server, instance, client);
  });

  connection.on('disconnect', (reason) => {
    connection.removeAllListeners();
    disconnectClient(server, instance, client);
  });

  connection.on('message', async (message: Buffer | string | MessagePackage) => {
    try {
      if (!instance.app.isActive()) {
        throw new ApiParserError(`Instance (${instance.id}) is not started`, ErrorCodes.SESSION_NOT_STARTED);
      }

      if (message instanceof Buffer) {
        message = message.toString('utf8');
      }

      let pm: MessagePackage = message as MessagePackage;

      if (typeof pm === 'string') {
        pm = MessagePackage.parser(message as string);
      }

      if (!pm) {
        // throw new ApiParserError(`Bad Request`, ErrorCodes.BAD_PARAMS);
        server.logger.warn(`Client: ${client.id} attempted: Bad Request ${ErrorCodes.BAD_PARAMS}`);
        return;
      }

      const clientId = client.data.aid;
      const instanceId = instance.id;

      auditLogger.info(`Incoming message from ${clientId} to ${instanceId} - method: ${pm.method}`);

      const handler = instance.socket[pm.method];

      // a special method for authorization
      if (pm.method === ServerConnectionAPI.AUTH) {
        client.auth = await authJwt({headers: { authorization: pm.data } }, '*') as AuthPayload;

        if (handler) {
          if (!instance.app.onSocketBefore(client.client, pm)) {
            // throw new ApiParserError(`${pm.method} rejected on socketBefore`, ErrorCodes.FORBIDDEN);
            server.logger.warn(`Client: ${client.id} attempted: ${pm.method} rejected on socketBefore ${ErrorCodes.FORBIDDEN}`);
            return;
          }

          await handler.call(instance.app, client.client, pm.data, req);
        }

        return;
      }

      if (!handler) {
        // throw new ApiParserError(`Method "${pm.method}" does not exist`, ErrorCodes.BAD_PARAMS);
        server.logger.warn(`Method "Client: ${client.id} attempted: ${pm.method}" does not exist ${ErrorCodes.BAD_PARAMS}`);
        return;
      }

      if (client.active) {
        if (!instance.app.onSocketBefore(client.client, pm)) {
          // throw new ApiParserError(`${pm.method} rejected on socketBefore`, ErrorCodes.FORBIDDEN);
          server.logger.warn(`Client: ${client.id} attempted: ${pm.method} rejected on socketBefore ${ErrorCodes.FORBIDDEN}`);
          return;
        }

        await handler.call(instance.app, client.client, pm.data, req);
      }
    } catch (err) {
      if (!err.code || err.code === ErrorCodes.BROKEN_APPLICATION) {
        apm.captureError(err, {
          custom: {
            url: req.url,
            headers: JSON.stringify(req.headers),
            client: JSON.stringify(client.data)
          }
        });
        server.logger.error(err.message);
      } else {
        server.logger.info(err.message);
      }

      let errorStatus: any = 'Internal server error';

      if (serverConfig.CONFIG.sut.enabled) {
        errorStatus = {
          message: err.message,
          stack: err.stack
        };
      }

      client.close((err.code || ErrorCodes.FORBIDDEN), errorStatus);
    }
  });
}

function inputErrorHandler(server: Server, req: IncomingMessage, client: ServerClientInterface, err) {
  if (!err.code || err.code === ErrorCodes.BROKEN_APPLICATION) {
    apm.captureError(err, {
      custom: {
        url: req.url,
        headers: JSON.stringify(req.headers),
        client: JSON.stringify(client.data)
      }
    });
    server.logger.error(err.message);
  } else {
    server.logger.info(err.message);
  }

  if (serverConfig.CONFIG.sut.enabled) {
    client.close(err.isPrimary ? err.code : ErrorCodes.KILL, {
      errno: err.code || ErrorCodes.FORBIDDEN,
      message: err.message,
      stack: err.stack
    });
  } else {
    client.close(err.isPrimary ? err.code : ErrorCodes.KILL, {
      errno: err.code || ErrorCodes.FORBIDDEN,
      message: 'Internal server error'
    });
  }
}

export async function webSocketInput(server: Server, connection: WebSocket, req: IncomingMessage): Promise<void> {
  const { appAlias, instAlias, params} = parseUrl(req.url);
  const client: ServerClient = new ServerClient(req, connection, appAlias, instAlias);

  try {
    if (AuthJwtFromRequest(req)) {
      client.auth = await authJwt(req, '*') as AuthPayload;
    }

    const instance = await getValidInstance(server, appAlias, instAlias, params, true);

    server.logger.debug(`WS call ${client.ip} ${req.url}`, { params });

    client.data = params;
    client.grants = params.grants;

    setConnectionApi(server, connection, instance, client, req);

    instance.addClient(client);
    server.logger.debug(`client (${client.id}) has been added (${instance.clientsLength})`);

    instance.app.onConnect(client.client);
  } catch (err) {
    inputErrorHandler(server, req, client, err);
  }
}

export async function socketIoInput(server: Server, socket: Socket, req: IncomingMessage): Promise<void> {
  let simulateReq;
  if (socket.handshake.auth.token) {
    simulateReq = {headers: {Authorization: `Bearer ${socket.handshake.auth.token}`}};
  }
  const [appAlias, instAlias] = socket.nsp.name.substring(1).split('.');

  const client = new ServerSocketIoClient(req, socket, appAlias, instAlias);

  try {
    if (simulateReq) {
      client.auth = await authJwt(simulateReq, '*') as AuthPayload;
    }
    client.data.grants = [appAlias];

    const instance = await getValidInstance(server, appAlias, instAlias, client.data, true);

    server.logger.debug(`WS call ${client.ip} ${req.url}`, client.data);

    setConnectionApi(server, socket, instance, client, req);

    instance.addClient(client);

    server.logger.debug(`client (${client.id}) has been added (${instance.clientsLength})`);

    instance.app.onConnect(client.client);
  } catch (err) {
    inputErrorHandler(server, req, client, err);
  }
}
