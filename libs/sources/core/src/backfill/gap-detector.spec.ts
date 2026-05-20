import { describe, expect, it } from 'vitest';
import { computeGap } from './gap-detector';

describe('computeGap', () => {
  it('#1 - returns skip when no start can be derived', () => {
    const out = computeGap({
      row: {
        active_from_block: null,
        backfill_head_block: null,
      },
      headBlock: 1000n,
      reorgHorizon: 10,
    });

    expect(out).toEqual({ kind: 'skip', reason: 'no_active_from_block' });
  });

  it('#2 - uses active_from_block when backfill head is null', () => {
    const out = computeGap({
      row: {
        active_from_block: '0',
        backfill_head_block: null,
      },
      headBlock: 30n,
      reorgHorizon: 10,
    });

    expect(out).toEqual({ kind: 'gap', gapStart: 0n, gapEnd: 10n });
  });

  it('#3 - returns none when no gap exists', () => {
    const out = computeGap({
      row: {
        active_from_block: '100',
        backfill_head_block: '120',
      },
      headBlock: 130n,
      reorgHorizon: 5,
    });

    expect(out).toEqual({ kind: 'none' });
  });

  it('#4 - uses backfill_head when present', () => {
    const out = computeGap({
      row: {
        active_from_block: '100',
        backfill_head_block: '140',
      },
      headBlock: 180n,
      reorgHorizon: 10,
    });

    expect(out).toEqual({ kind: 'gap', gapStart: 141n, gapEnd: 160n });
  });
});
