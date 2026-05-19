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

export interface BackfillRuntime {
  filter: import('@libs/chain').LogFilter;
  listenerFactory: (
    classifier: (blockNumber: bigint) => 'confirmed' | 'pending',
  ) => import('@libs/chain').EventsListener<import('@libs/chain').LogEvent>;
}
