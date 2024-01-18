export default class ContextError extends Error {
  constructor(message: string, readonly context: any) {
    super(message);
  }
}
