import { ErrorCodes } from '@container/models';

export type ParamDecName = 'jwt' | 'req' | 'res' | 'grants' | 'client';
export type GatewayDecMethod = 'post' | 'get' | 'ws';
export type GatewaySubjects = null | '*' | string[];

// @refer https://en.wikipedia.org/wiki/JSON_Web_Token
export interface AuthPayload {
  sub: string;
  iat: number;
  aud: string[];
  iss: string;
  exp: number;
  jti: string;
  nbf: number;
  uid: string;
  impersonated_id?: string;
}

export enum JwtSubjects {
  CORE_API_SERVER = '-core-api',
  LEGACY_BACKEND = '-legacy-backend',
  BOR_API_SERVER = '-bor-api',
  WEB_APP = '-web-app'
}

export class GatewayError extends Error {
  constructor(message: string,
    public code?: ErrorCodes
  ) {
    super(message);
  }
}
