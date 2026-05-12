import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { chainMetrics } from '@libs/chain';
import type { ReorgSignal } from '@libs/chain';
import { ReorgEventRepository } from '@libs/db';
import type { ChainContextRegistry } from './chain-context-registry';

@Injectable()
export class ReorgWatcherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ReorgWatcher');
  private readonly unsubscribeFns: Array<() => void> = [];

  constructor(
    private readonly registry: ChainContextRegistry,
    private readonly reorgRepo: ReorgEventRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.registry.whenReady();

    for (const chainCtx of this.registry.allActive()) {
      const unsubscribe = chainCtx.reorgDetector.onReorg(async (signal) => {
        await this.handleReorg(signal, chainCtx.chainCfg.name);
      });
      this.unsubscribeFns.push(unsubscribe);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const unsubscribe of this.unsubscribeFns) {
      try {
        unsubscribe();
      } catch {
        /* swallow */
      }
    }
    this.unsubscribeFns.length = 0;
  }

  private async handleReorg(signal: ReorgSignal, chainName: string): Promise<void> {
    const orphanedFiltered = signal.orphanedBlockHashes.filter((h): h is string => h !== null);

    const notes = buildReorgNotes(signal);

    try {
      const result = await this.reorgRepo.writeReorgEventAndOrphan({
        chainId: signal.chainId,
        detectedAt: signal.detectedAt,
        divergenceBlockNumber: signal.divergenceBlockNumber,
        orphanedBlockHashes: orphanedFiltered,
        canonicalBlockHashes: signal.canonicalBlockHashes,
        notes,
      });

      chainMetrics.reorgEvent.add(1, { chain_id: signal.chainId });
      chainMetrics.orphanedEvents.add(result.orphanedRowCount, { chain_id: signal.chainId });
      if (signal.truncated) {
        chainMetrics.reorgTruncated.add(1, { chain_id: signal.chainId });
      }

      this.logger.warn('reorg_handled', {
        chain: chainName,
        chain_id: signal.chainId,
        reorg_event_id: result.reorgEventId,
        divergence_block_number: signal.divergenceBlockNumber.toString(),
        orphan_count: result.orphanedRowCount,
        truncated: signal.truncated,
        chain_shrunk: signal.chainShrunk,
      });
    } catch (err) {
      this.logger.error('reorg_write_failed', {
        chain: chainName,
        chain_id: signal.chainId,
        divergence_block_number: signal.divergenceBlockNumber.toString(),
        error: String(err),
      });
    }
  }
}

function buildReorgNotes(signal: ReorgSignal): string | null {
  const flags: string[] = [];
  if (signal.truncated) flags.push('truncated');
  if (signal.chainShrunk) flags.push('chain_shrunk');
  return flags.length > 0 ? flags.join(';') : null;
}
