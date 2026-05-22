export interface FromBlockGateInput {
  fromBlock: bigint;
  activeFromBlock: string | null;
  backfillHeadBlock: string | null;
  confirmReplay: boolean;
}

export interface FromBlockGateViolation {
  code: 'below_active_floor' | 'replay_requires_confirmation';
  message: string;
}

export function validateFromBlockGate(input: FromBlockGateInput): FromBlockGateViolation | null {
  const activeFloor = input.activeFromBlock === null ? null : BigInt(input.activeFromBlock);
  const replayFloor =
    input.backfillHeadBlock === null ? null : BigInt(input.backfillHeadBlock) + 1n;

  if (activeFloor !== null && input.fromBlock < activeFloor) {
    return {
      code: 'below_active_floor',
      message: `--from-block (${input.fromBlock.toString()}) must be >= active_from_block (${input.activeFromBlock ?? 'NULL'})`,
    };
  }

  if (replayFloor !== null && input.fromBlock < replayFloor && input.confirmReplay !== true) {
    const blockDelta = (replayFloor - input.fromBlock).toString();
    return {
      code: 'replay_requires_confirmation',
      message:
        `--from-block (${input.fromBlock.toString()}) is below the current backfill_head_block (${input.backfillHeadBlock ?? 'NULL'}). ` +
        `Re-running will re-process ${blockDelta} blocks already archived (idempotent per ADR-041's 5-tuple existence check). ` +
        'Pass --confirm-replay to proceed. See docs/runbooks/m2-backfill.md.',
    };
  }

  return null;
}
