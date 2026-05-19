export interface GapRangeInput {
  active_from_block: string | null;
  backfill_head_block: string | null;
  live_head_block: string | null;
}

export type GapComputationResult =
  | { kind: 'gap'; gapStart: bigint; gapEnd: bigint }
  | { kind: 'none' }
  | { kind: 'skip'; reason: 'no_active_from_block' };

export function computeGap(input: {
  row: GapRangeInput;
  headBlock: bigint;
  reorgHorizon: number;
}): GapComputationResult {
  const { row, headBlock, reorgHorizon } = input;

  if (
    row.active_from_block === null &&
    row.backfill_head_block === null &&
    row.live_head_block === null
  ) {
    return { kind: 'skip', reason: 'no_active_from_block' };
  }

  const activeFrom = row.active_from_block === null ? null : BigInt(row.active_from_block);
  const backfillHead = row.backfill_head_block === null ? null : BigInt(row.backfill_head_block);
  const liveHead = row.live_head_block === null ? null : BigInt(row.live_head_block);

  const backfillBase = backfillHead ?? (activeFrom !== null ? activeFrom - 1n : null);
  const lastBlock =
    backfillBase === null
      ? (liveHead ?? 0n)
      : liveHead === null
        ? backfillBase
        : backfillBase > liveHead
          ? backfillBase
          : liveHead;

  const gapStart = lastBlock + 1n;
  const gapEnd = headBlock - BigInt(reorgHorizon) * 2n;

  if (gapEnd < gapStart) {
    return { kind: 'none' };
  }

  return { kind: 'gap', gapStart, gapEnd };
}
