/**
 * Internal control-flow signal — fires when the overall send() deadline elapses
 * before any provider responds. Caught inside FailoverRpcClient.send() and
 * converted into an AllProvidersFailedError attempt with reason 'timeout';
 * never surfaces to callers.
 */
export class DeadlineError extends Error {
  constructor() {
    super('overall deadline exceeded');
    this.name = 'DeadlineError';
  }
}
