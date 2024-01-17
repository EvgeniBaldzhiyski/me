import { ParamDecName } from '../types';

function setEndpointPropMetadata(
  decorator: ParamDecName,
  target: any,
  index: number,
  propName: string
) {
  const list = Reflect.getMetadata(`http-prop-gateway`, target, propName) || [];

  Reflect.defineMetadata(`http-prop-gateway`, [...list, { index, name: decorator }], target, propName);
}

/**
 * @property
 * @decorator
 */
export function jwt(target, propName, index) {
  setEndpointPropMetadata('jwt', target.constructor, index, propName);
}

/**
 * @property
 * @decorator
 */
export function req(target, propName, index) {
  setEndpointPropMetadata('req', target.constructor, index, propName);
}

/**
 * @property
 * @decorator
 */
export function res(target, propName, index) {
  setEndpointPropMetadata('res', target.constructor, index, propName);
}

/**
 * @property
 * @decorator
 */
export function grants(target, propName, index) {
  setEndpointPropMetadata('grants', target.constructor, index, propName);
}


/**
 * @property
 * @decorator
 */
export function client(target, propName, index) {
  setEndpointPropMetadata('client', target.constructor, index, propName);
}
