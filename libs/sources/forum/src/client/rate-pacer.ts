import { abortableDelay } from './abortable-delay';

export interface RatePacerOptions {
  /** Max requests per short window. Discourse default: 50. */
  maxPerShortWindow?: number;
  /** Short window length in ms. Discourse default: 10_000 (50 req / 10s). */
  shortWindowMs?: number;
  /** Max requests per long window. Discourse default: 200. */
  maxPerLongWindow?: number;
  /** Long window length in ms. Discourse default: 60_000 (200 req / min). */
  longWindowMs?: number;
  /** Injected clock in ms. Defaults to Date.now (overridable in tests). */
  now?: () => number;
  /** Injected abortable sleep. Defaults to a setTimeout-based delay (overridable in tests). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Proactively paces requests to one Discourse host under a sliding dual-window limit
 *  (≤50/10s AND ≤200/min), so the crawl self-throttles below the rate limit rather than
 *  relying on reactive 429 backoff. Acquisitions are serialised through an internal promise
 *  chain so concurrent callers can't both observe the same free slot. Per-host: construct one
 *  pacer per forum host. */
export class RatePacer {
  private readonly maxShort: number;
  private readonly shortWindowMs: number;
  private readonly maxLong: number;
  private readonly longWindowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  /** Ascending timestamps of granted slots within the long window. */
  private readonly grants: number[] = [];
  /** Tail of the serialisation chain; each acquire awaits the previous one. */
  private tail: Promise<void> = Promise.resolve();

  constructor(opts: RatePacerOptions = {}) {
    this.maxShort = opts.maxPerShortWindow ?? 50;
    this.shortWindowMs = opts.shortWindowMs ?? 10_000;
    this.maxLong = opts.maxPerLongWindow ?? 200;
    this.longWindowMs = opts.longWindowMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? abortableDelay;
  }

  /** Wait until a request slot is free under both windows, then reserve it. Rejects if the
   *  signal aborts while waiting. */
  async acquire(signal: AbortSignal): Promise<void> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    try {
      await prev;
      for (;;) {
        const now = this.now();
        this.prune(now);
        const shortCount = this.countSince(now - this.shortWindowMs);
        if (shortCount < this.maxShort && this.grants.length < this.maxLong) {
          this.grants.push(now);
          return;
        }
        await this.sleep(this.waitMs(now, shortCount), signal);
      }
    } finally {
      release();
    }
  }

  /** Drop grants that have fully exited the long window. */
  private prune(now: number): void {
    const cutoff = now - this.longWindowMs;
    let drop = 0;
    while (drop < this.grants.length && this.grants[drop]! <= cutoff) drop += 1;
    if (drop > 0) this.grants.splice(0, drop);
  }

  private countSince(since: number): number {
    let n = 0;
    for (let i = this.grants.length - 1; i >= 0 && this.grants[i]! > since; i -= 1) n += 1;
    return n;
  }

  /** Ms until at least one window frees a slot. When the short window is saturated, wait for its
   *  oldest in-window grant to expire; likewise for the long window; take the binding one. */
  private waitMs(now: number, shortCount: number): number {
    let wait = 0;
    if (shortCount >= this.maxShort) {
      const oldestInShort = this.grants[this.grants.length - this.maxShort]!;
      wait = Math.max(wait, oldestInShort + this.shortWindowMs - now);
    }
    if (this.grants.length >= this.maxLong) {
      const oldestInLong = this.grants[this.grants.length - this.maxLong]!;
      wait = Math.max(wait, oldestInLong + this.longWindowMs - now);
    }
    return Math.max(1, wait);
  }
}
