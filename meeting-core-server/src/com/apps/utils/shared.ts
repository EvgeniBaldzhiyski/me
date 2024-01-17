import Client, { ClientState } from '../../utils/Client';
import { ClientConnectionAPI, ConnectionStatus } from '@container/models';
import { Application } from '../../utils/Application';
import ServerAPI from '../../utils/ServerAPI';

/**
 * Reject connection to the Api and disconnect
 *
 * @param {Client} client - the Client App instance
 * @param { Application } initiator
 * @param {number} code - message code
 * @param {string} message - message
 */
export function rejectConnection(server: ServerAPI, client: Client, initiator: Application, code: number, message: string = '') {
  client.data.rejected = { message, code };
  client.state = ClientState.REJECTED;

  server.sendTo(ClientConnectionAPI.CONNECT, new ConnectionStatus(ConnectionStatus.REJECT, message, code), client.id, true);

  initiator.server.disconnect(client.id, code, message);

  initiator.logger.info(`-= CLIENT (${client.data.aid}) HAS BEEN REJECTED =-`, {
    rejectCode: code,
    rejectMessage: message,
    clientId: client?.id,
    ip: client?.ip
  });
}
