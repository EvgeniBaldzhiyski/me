/**
 * @app
 * @decorator
 */
export function Guard(allow?: '*' | string[]): ClassDecorator {
  return (target) => Reflect.defineMetadata(`http-app-guarding-gateway`, allow || '*', target);
}