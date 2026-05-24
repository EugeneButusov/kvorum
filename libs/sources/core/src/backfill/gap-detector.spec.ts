import { describe, expect, it } from 'vitest';
import { computeGap } from './gap-detector';

describe('computeGap', () => {
  it('#1 - returns skip when no start can be derived', () => {
    const out = computeGap({
      row: {
        active_from_block: null,
        backfill_head_block: null,
      },
      confirmedHead: 1000n,
    });

    expect(out).toEqual({ kind: 'skip', reason: 'no_active_from_block' });
  });

  it('#2 - uses active_from_block when backfill head is null', () => {
    const out = computeGap({
      row: {
        active_from_block: '0',
        backfill_head_block: null,
      },
      confirmedHead: 10n,
    });

    expect(out).toEqual({ kind: 'gap', gapStart: 0n, gapEnd: 10n });
  });

  it('#3 - returns none when no gap exists', () => {
    const out = computeGap({
      row: {
        active_from_block: '100',
        backfill_head_block: '120',
      },
      confirmedHead: 120n,
    });

    expect(out).toEqual({ kind: 'none' });
  });

  it('#4 - uses backfill_head when present', () => {
    const out = computeGap({
      row: {
        active_from_block: '100',
        backfill_head_block: '140',
      },
      confirmedHead: 160n,
    });

    expect(out).toEqual({ kind: 'gap', gapStart: 141n, gapEnd: 160n });
  });
});
