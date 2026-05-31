import { PgBoss } from 'pg-boss';
import type { IngestionDlq } from '@libs/db';
import type { RawLogJob } from '@sources/core';
import type { DlqRetryAdapter, RetryOutcome } from './dlq-retry-adapter.js';
import type { DlqRetryStage } from '../dlq-retry-stage.js';

const ARCHIVE_LOG_QUEUE = 'archive_log'; // pg-boss queue name (apps/indexer/src/queue/queue-names.ts)

function toRawLogJob(dlqEntry: IngestionDlq): RawLogJob {
  const payload = dlqEntry.payload as {
    raw?: { topics?: string[]; data?: string };
    block_number?: string;
    address?: string;
  };

  if (
    dlqEntry.archive_chain_id == null ||
    dlqEntry.archive_tx_hash == null ||
    dlqEntry.archive_log_index == null ||
    dlqEntry.archive_block_hash == null ||
    payload.address == null ||
    payload.block_number == null ||
    payload.raw?.topics == null ||
    payload.raw.data == null
  ) {
    throw new Error(
      'DLQ entry is missing fields needed for pg-boss re-enqueue ' +
        '(address, block_number, raw.topics, raw.data, archive coords). ' +
        'Entries written before PR-D (no address field) cannot be re-enqueued; ' +
        'use admin-cli backfill instead.',
    );
  }

  return {
    chainId: dlqEntry.archive_chain_id,
    blockNumber: payload.block_number,
    blockHash: dlqEntry.archive_block_hash,
    txHash: dlqEntry.archive_tx_hash,
    logIndex: dlqEntry.archive_log_index,
    address: payload.address,
    topics: payload.raw.topics,
    data: payload.raw.data,
  };
}

export class PgBossReEnqueueAdapter implements DlqRetryAdapter {
  // R-EXEC-B2: migrate:false on the constructor (not start()); start() is verify-only.
  private readonly boss = new PgBoss({
    connectionString: process.env['DATABASE_URL'],
    schema: 'pgboss',
    migrate: false,
  });
  private started = false;

  constructor(private readonly stageName: DlqRetryStage) {}

  get stage(): string {
    return this.stageName;
  }

  async retry(dlqEntry: IngestionDlq): Promise<RetryOutcome> {
    if (!this.started) {
      await this.boss.start();
      this.started = true;
    }
    const job = toRawLogJob(dlqEntry);
    await this.boss.send(ARCHIVE_LOG_QUEUE, job);
    return { status: 'resolved', reason: `re-enqueued to ${ARCHIVE_LOG_QUEUE}` };
  }
}
