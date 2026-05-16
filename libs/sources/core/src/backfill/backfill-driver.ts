import { BackfillRangeFetcher } from '@libs/chain';
import type { BackfillRangeFetcherResult } from '@libs/chain';
import type { ChainConfig, EventsListener, LogFilter, Logger, RpcClient } from '@libs/chain';
import type { DaoSourceRepository } from '@libs/db';
import { makeCutoffClassifier } from './cutoff-classifier';
import {
  BackfillAlreadyStartedError,
  BackfillNotResumableError,
  type BackfillOutcome,
  type BackfillRunInput,
} from './types';

export interface BackfillDriverDeps {
  rpcClient: RpcClient;
  daoSourceRepo: DaoSourceRepository;
  chainConfig: ChainConfig;
  /** eth_getLogs filter for the specific contract/topics being backfilled. */
  filter: LogFilter;
  /** Factory called during run() with the computed classifier so the caller can wire
   *  confirmationClassifier into the ArchiveWriteContext without coupling the driver
   *  to any source-specific import. */
  listenerFactory: (classifier: (blockNumber: bigint) => 'confirmed' | 'pending') => EventsListener;
  logger: Logger;
}

export class BackfillDriver {
  constructor(private readonly deps: BackfillDriverDeps) {}

  async run(input: BackfillRunInput & { force?: boolean }): Promise<BackfillOutcome> {
    const { rpcClient, daoSourceRepo, chainConfig, filter, listenerFactory, logger } = this.deps;

    // Step 1 — load source row with chain info
    const row = await daoSourceRepo.findByIdWithChain(input.daoSourceId);
    if (!row) {
      throw new Error(`dao_source ${input.daoSourceId} not found`);
    }

    let head: bigint;

    // Step 2 — resolve chain head (fresh captures new head; resume rehydrates from DB)
    if (input.mode === 'fresh') {
      if (row.backfill_started_at_block !== null && !input.force) {
        throw new BackfillAlreadyStartedError(input.daoSourceId, row.backfill_started_at_block);
      }
      await daoSourceRepo.clearBackfillState(input.daoSourceId);
      const headHex = await rpcClient.send<string>('eth_blockNumber', []);
      head = BigInt(headHex);
      // captureBackfillStart is idempotent (IS NULL guard) — fine after clearBackfillState
      await daoSourceRepo.captureBackfillStart(input.daoSourceId, head);
    } else {
      if (row.backfill_started_at_block === null) {
        throw new BackfillNotResumableError(input.daoSourceId);
      }
      // Rehydrate the original head — never refresh (ADR-027 determinism)
      head = BigInt(row.backfill_started_at_block);
    }

    // Step 3 — cutoff = head − 2×reorgHorizon (ADR-027 + ADR-046)
    const cutoffBlock = head - BigInt(chainConfig.reorgHorizon) * 2n;

    // Step 4 — build per-event classifier and listener
    const classifier = makeCutoffClassifier(cutoffBlock);
    const listener = listenerFactory(classifier);

    // Step 5 — resolve range
    const startBlock =
      input.mode === 'resume' && row.backfill_head_block !== null
        ? BigInt(row.backfill_head_block) + 1n
        : input.fromBlock;
    const toBlock = input.toBlock ?? head;

    logger.info('backfill_run_start', {
      daoSourceId: input.daoSourceId,
      mode: input.mode,
      fromBlock: startBlock.toString(),
      toBlock: toBlock.toString(),
      cutoffBlock: cutoffBlock.toString(),
      head: head.toString(),
    });

    // Step 6 — drive range fetcher with per-chunk checkpoint
    let fetcherResult: BackfillRangeFetcherResult;
    let lastCheckpointedBlock: bigint | null = null;

    try {
      const fetcher = new BackfillRangeFetcher({
        rpcClient,
        filter,
        sourceType: row.source_type,
        chainId: chainConfig.chainId,
        sourceLabel: row.source_type,
        listener,
        fromBlock: startBlock,
        toBlock,
        chunkSize: input.chunkSize,
        signal: input.signal,
        logger,
        onChunkComplete: async (chunkEnd) => {
          await daoSourceRepo.updateBackfillHead(input.daoSourceId, chunkEnd);
          lastCheckpointedBlock = chunkEnd;
        },
      });

      fetcherResult = await fetcher.run();
    } catch (err) {
      // Checkpoint was not advanced for the failed chunk — resume replays it
      const resumeFromBlock =
        lastCheckpointedBlock !== null ? lastCheckpointedBlock + 1n : startBlock;
      logger.error('backfill_run_error', {
        daoSourceId: input.daoSourceId,
        error: String(err),
        resumeFromBlock: resumeFromBlock.toString(),
      });
      return { status: 'error', error: err, resumeFromBlock };
    }

    if ('cancelled' in fetcherResult) {
      const resumeFromBlock =
        fetcherResult.lastCompletedBlock !== null
          ? fetcherResult.lastCompletedBlock + 1n
          : startBlock;
      logger.info('backfill_run_cancelled', {
        daoSourceId: input.daoSourceId,
        resumeFromBlock: resumeFromBlock.toString(),
      });
      return { status: 'cancelled', resumeFromBlock };
    }

    logger.info('backfill_run_completed', {
      daoSourceId: input.daoSourceId,
      fromBlock: startBlock.toString(),
      toBlock: toBlock.toString(),
    });

    // Leave both checkpoint columns populated on natural completion (Q4 / decision #11).
    // I2's 'backfill status' + explicit finalize clears them.
    return { status: 'completed', fromBlock: startBlock, toBlock };
  }
}
