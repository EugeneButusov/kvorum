import type { Logger } from '@libs/chain';

/**
 * Human-readable progress for `backfill run` (the multi-source orchestrator). Renders per-source
 * block-range progress bars, off-chain drain ticks, and an overall `[k/N]` source counter to stderr
 * — leaving stdout free for the machine-readable summary (so `--format json` stays pipeable).
 *
 * Output is line-based (never `\r`-overwrites): the parallel phase interleaves several sources, and
 * the CLI is most often run under `kubectl exec` (non-TTY), where a cursor-rewrite would be noise.
 * Emission is throttled per source (by percentage delta and elapsed time) so a multi-million-block
 * range does not flood the log with thousands of chunk lines.
 */

const BAR_WIDTH = 24;
/** Emit a new EVM progress line once the completion percentage advances by at least this much… */
const PCT_STEP = 2;
/** …or once this many milliseconds have elapsed since the last line for that source. */
const TIME_STEP_MS = 3000;
/** Off-chain drains have no known total, so pace their lines purely by elapsed time. */
const OFFCHAIN_TIME_STEP_MS = 1500;

export interface OffChainTickInfo {
  tick: number;
  items: number;
  quiescent: number;
}

export interface ProgressReporter {
  /** One-time banner naming the DAO and the total number of sources to be processed. */
  runStart(dao: string, total: number): void;
  /** Phase divider (e.g. "Phase 1 — mainnet spine"). */
  phase(label: string): void;
  /** A source is about to run; `detail` describes mode + block span (or the off-chain drain). */
  sourceStart(seq: number, total: number, label: string, detail: string): void;
  /** A `@libs/chain` Logger for one EVM source's BackfillDriver — renders a throttled progress bar. */
  sourceLogger(
    seq: number,
    total: number,
    label: string,
    fromBlock: bigint,
    toBlock: bigint,
  ): Logger;
  /** An `onTick` callback for one off-chain source's drain — renders throttled tick/item counters. */
  offChainTick(seq: number, total: number, label: string): (info: OffChainTickInfo) => void;
  /** A source finished; `status` is completed/cancelled/error/skipped, `detail` optional. */
  sourceDone(seq: number, total: number, label: string, status: string, detail?: string): void;
}

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const DISABLED: ProgressReporter = {
  runStart: () => {},
  phase: () => {},
  sourceStart: () => {},
  sourceLogger: () => NOOP_LOGGER,
  offChainTick: () => () => {},
  sourceDone: () => {},
};

export function createProgressReporter(opts: {
  enabled: boolean;
  write?: (line: string) => void;
  now?: () => number;
}): ProgressReporter {
  if (!opts.enabled) return DISABLED;

  const write = opts.write ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  const now = opts.now ?? ((): number => Date.now());

  return {
    runStart(dao, total) {
      write(`Backfill run for ${dao} — ${total} ${total === 1 ? 'source' : 'sources'}`);
    },

    phase(label) {
      write(`\n${label}`);
    },

    sourceStart(seq, total, label, detail) {
      write(`→ ${tag(seq, total, label)}  ${detail}`);
    },

    sourceLogger(seq, total, label, fromBlock, toBlock) {
      const span = toBlock - fromBlock;
      const prefix = `  ${tag(seq, total, label)}`;
      let lastPct = -PCT_STEP; // guarantees the first chunk line is emitted
      let lastAt = 0;
      return {
        debug: () => {},
        info: (message: string, ...args: unknown[]) => {
          if (message !== 'backfill_chunk_complete') return;
          const data = args[0] as Record<string, unknown> | undefined;
          const chunkEnd = toBigint(data?.['chunkEnd']);
          if (chunkEnd == null) return;
          const pct = percentOf(chunkEnd, fromBlock, span);
          const at = now();
          if (pct - lastPct < PCT_STEP && at - lastAt < TIME_STEP_MS) return;
          lastPct = pct;
          lastAt = at;
          write(
            `${prefix}  [${bar(pct)}] ${String(pct).padStart(3)}%  block ${fmt(chunkEnd)} / ${fmt(toBlock)}`,
          );
        },
        warn: (message: string, ...args: unknown[]) =>
          write(`${prefix}  WARN ${message}${suffix(args)}`),
        error: (message: string, ...args: unknown[]) =>
          write(`${prefix}  ERROR ${message}${suffix(args)}`),
      };
    },

    offChainTick(seq, total, label) {
      const prefix = `  ${tag(seq, total, label)}`;
      let cumulative = 0;
      let lastAt = Number.NEGATIVE_INFINITY; // guarantees the first tick is emitted
      return ({ tick, items, quiescent }) => {
        cumulative += items;
        const at = now();
        // Always surface quiescence ramp-up (it means the drain is about to finish); otherwise pace by time.
        if (quiescent === 0 && at - lastAt < OFFCHAIN_TIME_STEP_MS) return;
        lastAt = at;
        write(`${prefix}  tick ${tick}  +${items} (Σ${cumulative})  quiescent ${quiescent}`);
      };
    },

    sourceDone(seq, total, label, status, detail) {
      const mark = status === 'completed' || status === 'skipped' ? '✓' : '✗';
      write(`${mark} ${tag(seq, total, label)}  ${status}${detail ? ` (${detail})` : ''}`);
    },
  };
}

function tag(seq: number, total: number, label: string): string {
  return `[${seq}/${total}] ${label}`;
}

function bar(pct: number): string {
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((BAR_WIDTH * pct) / 100)));
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

/** Integer completion percent of `chunkEnd` within [fromBlock, fromBlock + span], clamped to 0..100. */
export function percentOf(chunkEnd: bigint, fromBlock: bigint, span: bigint): number {
  if (span <= 0n) return 100;
  const done = chunkEnd - fromBlock;
  const clamped = done < 0n ? 0n : done > span ? span : done;
  return Math.min(100, Number((clamped * 100n) / span));
}

function fmt(value: bigint): string {
  return value.toLocaleString('en-US');
}

function toBigint(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function suffix(args: readonly unknown[]): string {
  return args.length > 0 ? ` ${JSON.stringify(args.length === 1 ? args[0] : args)}` : '';
}
