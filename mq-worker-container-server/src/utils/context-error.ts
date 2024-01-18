export default class ContextError extends Error {
  constructor(message: string, readonly context: unknown) {
    super(message);
  }
}
