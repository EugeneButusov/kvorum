import { BackfillRangeFetcher, chainMetrics, readConfirmedHead } from '@libs/chain';
import type { BackfillRangeFetcherResult } from '@libs/chain';
import type { ChainConfig, EventsListener, LogFilter, Logger, RpcClient } from '@libs/chain';
import type { DaoSourceRepository } from '@libs/db';
import { BackfillAlreadyStartedError } from './errors/backfill-already-started.error';
import { BackfillNotResumableError } from './errors/backfill-not-resumable.error';
import type { BackfillOutcome, BackfillRunInput } from './types';

export interface BackfillDriverDeps {
  rpcClient: RpcClient;
  daoSourceRepo: DaoSourceRepository;
  chainConfig: ChainConfig;
  /** eth_getLogs filter for the specific contract/topics being backfilled. */
  filter: LogFilter;
  /** Factory called during run() to construct a source-specific log listener. */
  listenerFactory: () => EventsListener;
  logger: Logger;
}

export class BackfillDriver {
  constructor(private readonly deps: BackfillDriverDeps) {}

  async run(input: BackfillRunInput): Promise<BackfillOutcome> {
    const { rpcClient, daoSourceRepo, chainConfig, filter, listenerFactory, logger } = this.deps;

    // Step 1 — load source row with chain info
    const row = await daoSourceRepo.findByIdWithChain(input.daoSourceId);
    if (!row) {
      throw new Error(`dao_source ${input.daoSourceId} not found`);
    }

    let head: bigint;
    let startBlock: bigint;
    let toBlock: bigint;

    // Step 2 — resolve chain head (fresh captures new head; resume rehydrates from DB)
    if (input.mode === 'fresh') {
      if (row.backfill_started_at_block !== null && !input.force) {
        throw new BackfillAlreadyStartedError(input.daoSourceId);
      }
      await daoSourceRepo.clearBackfillState(input.daoSourceId);
      const headHex = await rpcClient.send<string>('eth_blockNumber', []);
      head = BigInt(headHex);
      // captureBackfillStart is idempotent (IS NULL guard) — fine after clearBackfillState
      await daoSourceRepo.captureBackfillStart(input.daoSourceId, head);
      startBlock = input.fromBlock;
      toBlock = input.toBlock ?? head;
    } else {
      if (input.mode === 'resume') {
        if (row.backfill_started_at_block === null) {
          throw new BackfillNotResumableError(input.daoSourceId);
        }
        // Rehydrate the original head — never refresh (ADR-027 determinism)
        head = BigInt(row.backfill_started_at_block);
        startBlock =
          row.backfill_head_block !== null ? BigInt(row.backfill_head_block) + 1n : input.fromBlock;
        toBlock = input.toBlock ?? head;
      } else {
        const floor =
          row.backfill_head_block !== null
            ? BigInt(row.backfill_head_block)
            : row.active_from_block !== null
              ? BigInt(row.active_from_block) - 1n
              : null;
        if (floor === null) {
          throw new Error(
            `dao_source ${input.daoSourceId} has no active_from_block and no backfill_head_block`,
          );
        }
        startBlock = floor + 1n;
        if (input.toBlock !== undefined) {
          toBlock = input.toBlock;
          head = toBlock;
        } else {
          const headHex = await rpcClient.send<string>('eth_blockNumber', []);
          head = BigInt(headHex);
          toBlock = await readConfirmedHead(rpcClient, chainConfig, row.id);
        }
        if (row.backfill_started_at_block === null) {
          await daoSourceRepo.captureBackfillStart(input.daoSourceId, startBlock);
        }
        if (startBlock > toBlock) {
          chainMetrics.ingestionGapFillSkipped.add(1, {
            chain: chainConfig.name,
            dao_source: row.id,
            reason: 'above_floor',
          });
          return { status: 'completed', fromBlock: startBlock, toBlock };
        }
      }
    }

    // Step 3 — construct listener
    const listener = listenerFactory();

    // Step 5 — resolve range
    logger.info('backfill_run_start', {
      daoSourceId: input.daoSourceId,
      mode: input.mode,
      fromBlock: startBlock.toString(),
      toBlock: toBlock.toString(),
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
          logger.info('backfill_chunk_complete', {
            daoSourceId: input.daoSourceId,
            chunkEnd: chunkEnd.toString(),
          });
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
    // Checkpoint columns are cleared by the caller (admin-cli backfill start) on completion.
    return { status: 'completed', fromBlock: startBlock, toBlock };
  }
}
