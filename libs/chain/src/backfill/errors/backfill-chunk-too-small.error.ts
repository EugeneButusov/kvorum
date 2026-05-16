export class BackfillChunkTooSmallError extends Error {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;

  constructor(fromBlock: bigint, toBlock: bigint) {
    super(
      `Backfill chunk [${fromBlock}..${toBlock}] still fails at the minimum chunk size; ` +
        `likely a bad address/topic filter or an unusually dense block range.`,
    );
    this.name = 'BackfillChunkTooSmallError';
    this.fromBlock = fromBlock;
    this.toBlock = toBlock;
  }
}
