export type BackfillMode = 'fresh' | 'resume';

export interface BackfillRunInput {
  daoSourceId: string;
  fromBlock: bigint;
  toBlock?: bigint;
  mode: BackfillMode;
  /** When provided, the driver aborts at the next chunk boundary. */
  signal?: AbortSignal;
  /** Override the default chunk size (10_000). Exposed for tests. */
  chunkSize?: number;
}

export type BackfillOutcome =
  | { status: 'completed'; fromBlock: bigint; toBlock: bigint }
  | { status: 'cancelled'; resumeFromBlock: bigint | null }
  | { status: 'error'; error: unknown; resumeFromBlock: bigint | null };

export class BackfillNotResumableError extends Error {
  constructor(daoSourceId: string) {
    super(
      `Cannot resume backfill for dao_source ${daoSourceId}: backfill_started_at_block is null. ` +
        `Run with mode='fresh' to start a new backfill.`,
    );
    this.name = 'BackfillNotResumableError';
  }
}

export class BackfillAlreadyStartedError extends Error {
  constructor(daoSourceId: string, startedAtBlock: string) {
    super(
      `Cannot start a fresh backfill for dao_source ${daoSourceId}: ` +
        `a backfill is already in progress (started at block ${startedAtBlock}). ` +
        `Pass force=true to clear state and re-capture, or use mode='resume' to continue.`,
    );
    this.name = 'BackfillAlreadyStartedError';
  }
}
