import type { ErrorReason } from './errors.js';

export class AllProvidersFailedError extends Error {
  readonly chainId: string;
  readonly attempts: Array<{ provider: string; reason: ErrorReason; cause: unknown }>;

  constructor(
    chainId: string,
    attempts: Array<{ provider: string; reason: ErrorReason; cause: unknown }>,
  ) {
    super(`All providers failed for chain ${chainId}`);
    this.name = 'AllProvidersFailedError';
    this.chainId = chainId;
    this.attempts = attempts;
  }
}
