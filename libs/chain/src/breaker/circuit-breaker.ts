export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // failures within window before opening; default 5
  windowMs?: number; // rolling window for failure counting; default 60_000
  cooldownMs?: number; // how long to stay open before going half-open; default 30_000
  now?: () => number; // injectable clock for tests
}

interface FailureRecord {
  at: number;
}

/** Non-null marker stored on `inFlightProbe` to gate concurrent half-open callers.
 *  The promise is never awaited — single-flight gating works through the null check. */
const PROBE_SENTINEL: Promise<void> = Promise.resolve();

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failures: FailureRecord[] = [];
  private openedAt: number | null = null;
  /** Single-flight half-open probe — only one concurrent caller gets the probe permit. */
  private inFlightProbe: Promise<void> | null = null;

  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.windowMs = opts.windowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Atomically check whether the caller may proceed and (if half-open) claim the probe slot.
   * Returns true on grant, false otherwise. Half-open: only one concurrent caller gets true —
   * all others get false until the probe settles via recordSuccess/recordFailure.
   * Node.js single-thread event loop makes the check-and-set atomic.
   */
  tryAcquire(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      if (this.openedAt !== null && this.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half-open';
        // fall through to half-open handling
      } else {
        return false;
      }
    }

    // half-open: grant permit only if no probe is in flight, then claim it
    if (this.inFlightProbe !== null) return false;
    this.inFlightProbe = PROBE_SENTINEL;
    return true;
  }

  recordSuccess(): void {
    this.failures = [];
    this.openedAt = null;
    this.inFlightProbe = null;
    this.state = 'closed';
  }

  recordFailure(): void {
    const now = this.now();
    // Prune failures outside the rolling window
    this.failures = this.failures.filter((f) => now - f.at < this.windowMs);
    this.failures.push({ at: now });

    if (this.state === 'half-open') {
      // Probe failed — reopen with fresh cooldown
      this.state = 'open';
      this.openedAt = now;
      this.inFlightProbe = null;
      return;
    }

    if (this.state === 'closed' && this.failures.length >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
    }
  }

  /**
   * Release a half-open probe slot without recording success or failure.
   * Use when a request was acquired but never actually exercised the provider —
   * e.g., the overall deadline expired before the response arrived.
   * No-op when the breaker is not in half-open state.
   */
  recordAbandoned(): void {
    if (this.state === 'half-open') {
      this.inFlightProbe = null;
    }
  }
}
