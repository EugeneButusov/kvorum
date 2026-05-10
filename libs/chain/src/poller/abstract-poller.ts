import { silentLogger, type Logger } from '../logger.js';

const DEFAULT_POLL_INTERVAL_MS = 12_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export interface AbstractPollerOptions {
  chainName: string;
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
  logger?: Logger;
}

/** Lifecycle scaffold shared by EventPoller and HeadTracker.
 *
 *  Concerns owned by the base:
 *    - periodic-tick scheduling via setInterval
 *    - re-entry guard (skip a tick if the previous one is still running)
 *    - terminal-after-stop (a stopped instance cannot be restarted)
 *    - graceful stop with a hard `stopTimeoutMs` race against any in-flight tick
 *
 *  Subclasses implement {@link runTick} (the actual RPC work) and {@link logContext}
 *  (the log prefix including class name). Two optional hooks — {@link validateStart}
 *  and {@link onStopBeforeRace} — let subclasses inject pre-start checks
 *  (e.g. "must have a listener registered") and stop-time cleanup (e.g. rejecting
 *  pending awaitFirstHead waiters). */
export abstract class AbstractPoller {
  protected readonly logger: Logger;
  protected readonly chainName: string;
  protected readonly pollIntervalMs: number;
  protected readonly stopTimeoutMs: number;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  protected stopped = false;
  private inFlightPromise: Promise<void> | null = null;

  protected constructor(opts: AbstractPollerOptions) {
    this.logger = opts.logger ?? silentLogger;
    this.chainName = opts.chainName;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  /** Log prefix the subclass wants attached to every base-emitted warn,
   *  including the class identity. e.g. `"[chain:eth] HeadTracker"`. */
  protected abstract logContext(): string;

  /** Body of one poll iteration. Errors must be caught by the subclass —
   *  the base treats any throw from runTick as an unhandled programming bug. */
  protected abstract runTick(): Promise<void>;

  /** Override to assert preconditions at start() time (e.g. listener registered).
   *  Throw to abort start; the base will not install the interval. */
  protected validateStart(): void {
    // default: no-op
  }

  /** Override to run subclass-specific cleanup inside stop() *after* the
   *  interval is cleared but *before* the in-flight tick is awaited. */
  protected onStopBeforeRace(): void {
    // default: no-op
  }

  isRunning(): boolean {
    return !this.stopped && this.intervalHandle !== null;
  }

  /** Terminal-after-stop: a stopped instance cannot be restarted. */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error(
        `${this.logContext()} start() called on a stopped instance — terminal-after-stop`,
      );
    }
    this.validateStart();
    await this.tick();
    if (this.stopped) return;
    this.intervalHandle = setInterval(() => {
      void this.scheduledTick();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.onStopBeforeRace();
    if (this.inFlightPromise) {
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          this.logger.warn(
            `${this.logContext()} stop() deadline (${this.stopTimeoutMs}ms) exceeded — forcing shutdown`,
          );
          resolve();
        }, this.stopTimeoutMs),
      );
      await Promise.race([this.inFlightPromise, timeout]);
    }
  }

  private async scheduledTick(): Promise<void> {
    if (this.isPolling) {
      this.logger.warn(`${this.logContext()} tick skipped — previous tick still in flight`);
      return;
    }
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    this.isPolling = true;
    let resolve!: () => void;
    this.inFlightPromise = new Promise<void>((r) => {
      resolve = r;
    });
    try {
      await this.runTick();
    } finally {
      this.isPolling = false;
      resolve();
      this.inFlightPromise = null;
    }
  }
}
