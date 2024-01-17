import { custom, Issuer, TokenSet } from 'openid-client';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent, AgentOptions } from 'https';
import config from 'config';
import serverConfig from './serverConfig';

export async function getGhostUserAuth(): Promise<TokenSet> {
  // These agent options are chosen to match the npm client defaults and help with performance
  // See: `npm config get maxsockets` and #50
  // see https://github.com/sindresorhus/got/issues/815
  // TODO: Consider moving to HTTP/2 when infrastructure allows it for more efficient connections
  const agentOptions = {
    keepAlive: true,
    maxSockets: Infinity,
    ...config.get('openIdClient.agentOptions') as AgentOptions ?? {}
  };
  const httpAgent = new HttpAgent(agentOptions);
  const httpsAgent = new HttpsAgent(agentOptions);

  custom.setHttpOptionsDefaults({
    agent: {
      http: httpAgent,
      https: httpsAgent
    },
    timeout: config.get('openIdClient.timeout') ?? 15000
  });

  const AuthIssuer = await Issuer.discover(serverConfig.CONFIG.socketServerPortAuthorization.wellKnownConfig);
  const authClient = new AuthIssuer.Client({
    client_id: serverConfig.CONFIG.socketServerPortAuthorization.ghostUserClient.clientId,
    client_secret: serverConfig.CONFIG.socketServerPortAuthorization.ghostUserClient.clientSecret,
    response_types: ['id_token token'],
    token_endpoint_auth_method: 'client_secret_basic'
  });

  return await authClient.grant({
    grant_type: 'client_credentials',
    scope: serverConfig.CONFIG.socketServerPortAuthorization.ghostUserClient.scope,
    audience: serverConfig.CONFIG.socketServerPortAuthorization.ghostUserClient.audience
  });
}

