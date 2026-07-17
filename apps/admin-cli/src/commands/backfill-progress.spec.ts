import { describe, it, expect } from 'vitest';
import { createProgressReporter, percentOf } from './backfill-progress';

/** A reporter with a captured write buffer and a controllable clock. */
function makeReporter(enabled = true) {
  const lines: string[] = [];
  let clock = 0;
  const reporter = createProgressReporter({
    enabled,
    write: (line) => void lines.push(line),
    now: () => clock,
  });
  return {
    reporter,
    lines,
    tick: (ms: number) => (clock += ms),
    setClock: (ms: number) => (clock = ms),
  };
}

describe('percentOf', () => {
  it('returns the integer percent within the span', () => {
    expect(percentOf(50n, 0n, 100n)).toBe(50);
    expect(percentOf(25n, 0n, 100n)).toBe(25);
  });

  it('clamps above 100 and below 0', () => {
    expect(percentOf(150n, 0n, 100n)).toBe(100);
    expect(percentOf(-10n, 0n, 100n)).toBe(0);
  });

  it('treats a non-positive span as complete', () => {
    expect(percentOf(0n, 0n, 0n)).toBe(100);
    expect(percentOf(0n, 5n, -5n)).toBe(100);
  });

  it('offsets by fromBlock (resume ranges)', () => {
    // 60 of a 0..100 span that starts at block 1000 → block 1060.
    expect(percentOf(1060n, 1000n, 100n)).toBe(60);
  });
});

describe('createProgressReporter (disabled)', () => {
  it('never writes and returns a no-op logger', () => {
    const { reporter, lines } = makeReporter(false);
    reporter.runStart('compound', 3);
    reporter.phase('Phase 1');
    reporter.sourceStart(1, 3, 'x@0x1', 'fresh');
    const logger = reporter.sourceLogger(1, 3, 'x@0x1', 0n, 100n);
    logger.info('backfill_chunk_complete', { chunkEnd: '50' });
    reporter.offChainTick(2, 3, 'y@0x1')({ tick: 1, items: 5, quiescent: 0 });
    reporter.sourceDone(1, 3, 'x@0x1', 'completed');
    expect(lines).toEqual([]);
  });
});

describe('createProgressReporter (enabled)', () => {
  it('renders run/phase/source banners with [k/N] tags', () => {
    const { reporter, lines } = makeReporter();
    reporter.runStart('compound', 5);
    reporter.phase('Phase 1 — mainnet spine (serial)');
    reporter.sourceStart(3, 5, 'compound_governor_oz@0x1', 'resume, blocks 1 → 100');
    reporter.sourceDone(3, 5, 'compound_governor_oz@0x1', 'completed', '9,949 events');

    expect(lines[0]).toContain('compound');
    expect(lines[0]).toContain('5 sources');
    expect(lines[1]).toContain('Phase 1');
    expect(lines[2]).toBe('→ [3/5] compound_governor_oz@0x1  resume, blocks 1 → 100');
    expect(lines[3]).toBe('✓ [3/5] compound_governor_oz@0x1  completed (9,949 events)');
  });

  it('marks failed/cancelled sources with ✗', () => {
    const { reporter, lines } = makeReporter();
    reporter.sourceDone(1, 2, 'a@0x1', 'error', 'boom');
    reporter.sourceDone(2, 2, 'b@0x1', 'cancelled');
    expect(lines[0]).toBe('✗ [1/2] a@0x1  error (boom)');
    expect(lines[1]).toBe('✗ [2/2] b@0x1  cancelled');
  });

  it('emits only backfill_chunk_complete, ignoring other driver events', () => {
    const { reporter, lines } = makeReporter();
    const logger = reporter.sourceLogger(1, 1, 's@0x1', 0n, 100n);
    logger.info('backfill_run_start', { fromBlock: '0' });
    logger.debug('noise');
    expect(lines).toEqual([]);
    logger.info('backfill_chunk_complete', { chunkEnd: '10' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('10%');
    expect(lines[0]).toContain('block 10 / 100');
  });

  it('throttles chunk lines by percentage delta', () => {
    const { reporter, lines } = makeReporter();
    const logger = reporter.sourceLogger(1, 1, 's@0x1', 0n, 100n);
    logger.info('backfill_chunk_complete', { chunkEnd: '0' }); // 0% — first, emits
    logger.info('backfill_chunk_complete', { chunkEnd: '1' }); // 1% — below step, skipped
    logger.info('backfill_chunk_complete', { chunkEnd: '2' }); // 2% — meets step, emits
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('0%');
    expect(lines[1]).toContain('2%');
  });

  it('emits a sub-threshold chunk once enough time has elapsed', () => {
    const { reporter, lines, tick } = makeReporter();
    const logger = reporter.sourceLogger(1, 1, 's@0x1', 0n, 100n);
    logger.info('backfill_chunk_complete', { chunkEnd: '10' }); // emits (first)
    logger.info('backfill_chunk_complete', { chunkEnd: '11' }); // +1% same time → skip
    expect(lines).toHaveLength(1);
    tick(3000);
    logger.info('backfill_chunk_complete', { chunkEnd: '11' }); // +1% but 3s later → emit
    expect(lines).toHaveLength(2);
  });

  it('accumulates off-chain items and always shows quiescence ramp-up', () => {
    const { reporter, lines, tick } = makeReporter();
    const onTick = reporter.offChainTick(4, 6, 'forum@0x1');
    onTick({ tick: 1, items: 100, quiescent: 0 }); // first → emits, Σ100
    onTick({ tick: 2, items: 70, quiescent: 0 }); // same time, quiescent 0 → throttled
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[4/6] forum@0x1');
    expect(lines[0]).toContain('+100 (Σ100)');

    onTick({ tick: 3, items: 0, quiescent: 1 }); // quiescent>0 → always emits, cumulative carried
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('(Σ170)');
    expect(lines[1]).toContain('quiescent 1');

    tick(1500);
    onTick({ tick: 4, items: 5, quiescent: 0 }); // time elapsed → emits again
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('(Σ175)');
  });
});
