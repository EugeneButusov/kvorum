import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ChainContextRegistry, type ChainContext } from '@libs/chain';
import {
  ProposalRepository,
  type PendingTimestampFillRow,
  type TimestampFillInput,
} from '@libs/db';
import { readIntervalMs } from '@libs/utils';
import { derivationMetrics } from './derivation-metrics';

const TIMESTAMP_FILL_INTERVAL_MS = readIntervalMs('TIMESTAMP_FILL_INTERVAL_MS', 15_000);
const DEFAULT_TIMESTAMP_FILL_BATCH_SIZE = 25;

@Injectable()
export class TimestampFillerService implements OnApplicationBootstrap {
  private readonly logger = new Logger('TimestampFiller');
  private inFlight = false;

  constructor(
    private readonly proposals: ProposalRepository,
    private readonly registry: ChainContextRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    void this.tick();
  }

  @Interval(TIMESTAMP_FILL_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const batchSize = Number(
        process.env['TIMESTAMP_FILL_BATCH_SIZE'] ?? DEFAULT_TIMESTAMP_FILL_BATCH_SIZE,
      );
      const rows = await this.proposals.findPendingTimestampFill(batchSize);
      derivationMetrics.timestampFillBacklog.record(
        rows.length === batchSize ? batchSize + 1 : rows.length,
      );

      const updates = await this.resolveUpdates(rows);
      if (updates.length > 0) {
        await this.proposals.fillTimestamps(updates);
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async resolveUpdates(
    rows: readonly PendingTimestampFillRow[],
  ): Promise<TimestampFillInput[]> {
    const updates: TimestampFillInput[] = [];

    for (const row of rows) {
      const ctx = this.registry.peek(row.chain_id);
      if (ctx === undefined) continue;

      const [startsAt, endsAt] = await Promise.all([
        row.voting_starts_at !== null || row.voting_starts_block === null
          ? Promise.resolve(null)
          : this.tryFetchBlockTimestamp(ctx, row.voting_starts_block),
        row.voting_ends_at !== null || row.voting_ends_block === null
          ? Promise.resolve(null)
          : this.tryFetchBlockTimestamp(ctx, row.voting_ends_block),
      ]);

      if (startsAt !== null || endsAt !== null) {
        updates.push({ id: row.id, voting_starts_at: startsAt, voting_ends_at: endsAt });
      }
    }

    return updates;
  }

  private async tryFetchBlockTimestamp(
    ctx: ChainContext,
    blockNumber: string,
  ): Promise<Date | null> {
    try {
      const block = await ctx.client.send<unknown>('eth_getBlockByNumber', [
        `0x${BigInt(blockNumber).toString(16)}`,
        false,
      ]);
      if (block === null) {
        derivationMetrics.timestampFill.add(1, { result: 'block_not_mined_yet' });
        return null;
      }

      const timestamp = readBlockTimestamp(block);
      if (timestamp === null) {
        throw new Error('eth_getBlockByNumber returned block without timestamp');
      }

      derivationMetrics.timestampFill.add(1, { result: 'filled' });
      return new Date(Number(BigInt(timestamp)) * 1000);
    } catch (err) {
      derivationMetrics.timestampFill.add(1, { result: 'rpc_failed' });
      this.logger.warn('timestamp_fill_rpc_failed', {
        chain_id: ctx.chainCfg.chainId,
        block: blockNumber,
        error: String(err),
      });
      return null;
    }
  }
}

function readBlockTimestamp(block: unknown): string | null {
  if (typeof block !== 'object' || block === null || !('timestamp' in block)) return null;
  const timestamp = (block as { timestamp: unknown }).timestamp;
  return typeof timestamp === 'string' ? timestamp : null;
}
