import 'reflect-metadata';
import config from 'config';
import * as jwt from 'jsonwebtoken';
import jwks from 'jwks-rsa';
import ServerAPI from '../utils/ServerAPI';
import Client from '../utils/Client';
import { ErrorCodes } from '@container/models';
import { AuthPayload, GatewayDecMethod, GatewayError, GatewaySubjects, ParamDecName } from './types';

export function AuthJwtFromRequest(req): string {
  return ((req && req.headers && (req.headers['authorization'] || req.headers['Authorization'])) || '').replace('Bearer ', '');
}

const secretOrKey = Buffer.from(config.get('socketServerPortAuthorization.publicKey') as string, 'base64').toString('utf-8');
const allowAudiences = config.get<string>('socketServerPortAuthorization.audience').split(',');

// @todo add proper well-known link when it is stable generated
const jwksClient = jwks({ jwksUri: config.get('socketServerPortAuthorization.jwksUri') });
const getKey = (header, callback) => {
  jwksClient.getSigningKey(header.kid, (_, key) =>
    callback(null, key && key.getPublicKey())
  );
};

export async function authJwt(req, allow): Promise<AuthPayload | {}> {
  if (!config.get('socketServerPortAuthorization.activate')) {
    return {};
  }

  let payload: AuthPayload;
  const token = AuthJwtFromRequest(req);
  try {
    // @todo remove this verificate method after pre-sign token be removed
    payload = jwt.verify(token, secretOrKey) as AuthPayload;
  } catch (err) {
    payload = await new Promise((resolve, reject) => jwt.verify(token, getKey, {}, (err: Error, data: AuthPayload) => {
      if (err) {
        return reject(err);
      }

      resolve(data);
    }));
  }

  if (!payload || !allowAudiences.find(allowAudience => payload.aud.includes(allowAudience))) {
    throw new GatewayError('JWT with wrong audience', ErrorCodes.FORBIDDEN);
  }

  if (allow !== '*' && !allow.includes(payload.sub)) {
    throw new GatewayError('Authentication failure: Disallowed subject', ErrorCodes.FORBIDDEN);
  }

  return payload;
}

function guardHandler(
  type: GatewayDecMethod,
  handler: Function,
  appGuarding: GatewaySubjects,
  propGuarding: GatewaySubjects,
  paramList: { index: number, name: ParamDecName }[]
): Function {
  const allow = manageAllowSubjects(appGuarding, propGuarding);

  switch (type) {
    case 'post':
    case 'get':
      return async function (...args) {
        let payload = {};

        if (allow) {
          payload = await authJwt(args[0], allow);
        }

        const params = [ args[2], ...paramList.map(_ => args[2]) ];
        let hasRes = false;

        paramList.forEach(({ index, name }) => {
          switch (name) {
            case 'jwt':
              params[index] = payload;
              break;
            case 'req':
              params[index] = args[0];
              break;
            case 'res':
              hasRes = true;
              params[index] = args[1];
              break;
            case 'grants':
              params[index] = args[3];
              break;
            default:
              throw new Error('UnknownParameterType');
          }
        });

        const res = handler.apply(this, params);

        if (!hasRes) {
          args[1].send(200, 'Ok');
        }

        return res;
      };
    case 'ws':
      return function (...args) {
        const client = args[0] as Client;

        if (allow) {
          if (!client.auth) {
            throw new GatewayError('Authorization information is missing', ErrorCodes.FORBIDDEN);
          }

          if (allow !== '*' && !allow.includes(client.auth.sub)) {
            throw new GatewayError('Authentication failure: Disallowed subject', ErrorCodes.FORBIDDEN);
          }
        }
        const params = [ args[1], ...paramList.map(_ => args[1]) ];

        paramList.forEach(({ index, name }) => {
          switch (name) {
            case 'jwt':
              params[index] = client.auth;
              break;
            case 'req':
              params[index] = args[2];
              break;
            case 'client':
              params[index] = client;
              break;
            case 'grants':
              params[index] = client.data.grants;
              break;
            default:
              throw new Error('UnknownParameterType');
          }
        });

        return handler.apply(this, params);
      };
  }
}

function manageAllowSubjects(appGuarding: GatewaySubjects, propGuarding: GatewaySubjects): GatewaySubjects {
  let allow: GatewaySubjects = null;

  if (appGuarding) {
    allow = appGuarding;
  }

  if (propGuarding) {
    if (propGuarding === '*') {
      if (!allow) {
        allow = '*';
      }
    } else {
      if (!allow || allow === '*') {
        allow = [];
      }
      allow = [...new Set(allow.concat(propGuarding))];
    }
  }

  return allow;
}

export function gatewayScanner(inst, server: ServerAPI, parents: any[] = []) {
  let appGuarding: GatewaySubjects = null;

  parents.forEach(parent => {
    appGuarding = manageAllowSubjects(appGuarding,
      Reflect.getMetadata(`http-app-guarding-gateway`, parent.constructor || parent) || null
    );
  });

  appGuarding = manageAllowSubjects(appGuarding,
    Reflect.getMetadata(`http-app-guarding-gateway`, inst.constructor || inst) || null
  );

  ['ws', 'post', 'get'].forEach((type: GatewayDecMethod) => {
    const propList: string[] = Reflect.getMetadata(`http-${type}-gateway`, inst.constructor || inst);

    if (propList) {
      propList.forEach(name => {
        const { allow, endpoint } = Reflect.getMetadata(`http-${type}-gateway`, inst.constructor || inst, name);
        const paramList = Reflect.getMetadata(`http-prop-gateway`, inst.constructor || inst, name) || [];

        const handler = guardHandler(type, inst[name], appGuarding, allow || null, paramList).bind(inst);

        switch (type) {
          case 'post':
            server.onPost(endpoint, handler);
            break;
          case 'get':
            server.onGet(endpoint, handler);
            break;
          case 'ws':
            server.onSocket(endpoint, handler);
            break;
        }
      });
    }
  });
}
