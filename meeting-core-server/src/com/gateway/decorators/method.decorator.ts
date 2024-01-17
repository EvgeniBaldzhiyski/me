import { GatewayDecMethod } from '../types';

function setEndpointMetadata(
  type: GatewayDecMethod,
  target: any,
  propName: string,
  endpoint: string,
  allow?: '*' | string[]
) {
  const list = Reflect.getMetadata(`http-${type}-gateway`, target) || [];

  Reflect.defineMetadata(`http-${type}-gateway`, [...list, propName], target);
  Reflect.defineMetadata(`http-${type}-gateway`, { endpoint, allow }, target, propName);
}

/**
 * @appMethod
 * @decorator
 */
export function Get(endpoint: string, allow?: '*' | string[]): MethodDecorator {
  return (target, propName: string) => {
    setEndpointMetadata('get', target.constructor, propName, endpoint, allow);
  }
}

/**
 * @appMethod
 * @decorator
 */
export function Socket(endpoint: string, allow?: '*' | string[]): MethodDecorator {
  return (target, propName: string) => {
    setEndpointMetadata('ws', target.constructor, propName, endpoint, allow);
  }
}

/**
 * @appMethod
 * @decorator
 */
export function Post(endpoint: string, allow?: '*' | string[]): MethodDecorator {
  return (target, propName: string) => {
    setEndpointMetadata('post', target.constructor, propName, endpoint, allow);
  }
}
