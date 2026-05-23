import type { EventsListener } from '@libs/chain';
import { pgDb, type IngestionDlq } from '@libs/db';
import { DELEGATION_ARCHIVE_STAGE, type DlqRetryStage } from '../dlq-retry-stage.js';
import { makeDlqRetryListener } from '../dlq-retry-listener-factory.js';
import type { DlqRetryAdapter, RetryOutcome } from './dlq-retry-adapter.js';

interface ArchiveTuple {
  sourceType: string;
  chainId: string;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
  raw: { topics: string[]; data: string };
}

function parseArchiveTuple(row: IngestionDlq): ArchiveTuple {
  const payload = row.payload as {
    raw?: { topics?: string[]; data?: string };
    block_number?: string;
  };
  const raw = payload.raw;

  if (
    raw?.topics == null ||
    raw.data == null ||
    payload.block_number == null ||
    row.archive_tx_hash == null ||
    row.archive_log_index == null ||
    row.archive_block_hash == null ||
    row.archive_chain_id == null ||
    row.archive_source_type == null
  ) {
    throw new Error('DLQ payload is missing archive log fields');
  }

  return {
    sourceType: row.archive_source_type,
    chainId: row.archive_chain_id,
    blockNumber: BigInt(payload.block_number),
    blockHash: row.archive_block_hash,
    txHash: row.archive_tx_hash,
    logIndex: row.archive_log_index,
    raw: { topics: raw.topics, data: raw.data },
  };
}

export class ArchiveStageAdapter implements DlqRetryAdapter {
  constructor(private readonly stageName: DlqRetryStage) {}

  get stage(): string {
    return this.stageName;
  }

  async retry(row: IngestionDlq): Promise<RetryOutcome> {
    if (row.stage !== this.stageName) {
      throw new Error(`stage mismatch: adapter=${this.stageName}, row=${row.stage}`);
    }

    if (
      row.archive_source_type == null ||
      row.archive_chain_id == null ||
      row.archive_source_type.length === 0 ||
      row.archive_chain_id.length === 0
    ) {
      throw new Error('DLQ row is missing archive source tuple fields');
    }

    const tuple = parseArchiveTuple(row);
    const daoSourceId = await resolveDaoSourceId(row.archive_source_type, row.archive_chain_id);
    if (daoSourceId == null) {
      throw new Error('unable to resolve dao_source_id for DLQ row');
    }

    const listener = await makeDlqRetryListener({
      stage: row.stage,
      archiveSourceType: row.archive_source_type,
      archiveChainId: row.archive_chain_id,
      daoSourceId,
    });

    await listener([
      {
        sourceType: tuple.sourceType,
        chainId: tuple.chainId,
        blockNumber: tuple.blockNumber,
        blockHash: tuple.blockHash,
        txHash: tuple.txHash,
        txIndex: 0,
        logIndex: tuple.logIndex,
        address: '0x0000000000000000000000000000000000000000',
        topics: tuple.raw.topics,
        data: tuple.raw.data,
      },
    ]);

    return { status: 'resolved', reason: 'archive_write replay succeeded' };
  }
}

async function resolveDaoSourceId(sourceType: string, chainId: string): Promise<string | null> {
  const { DaoSourceRepository } = await import('@libs/db');
  const repo = new DaoSourceRepository(pgDb);
  const rows = await repo.findBySourceType(sourceType);
  const matching = rows.filter((row) => row.primary_chain_id === chainId);
  if (matching.length !== 1 || matching[0] == null) {
    return null;
  }
  return matching[0].id;
}

export const ARCHIVE_STAGES: readonly DlqRetryStage[] = [
  'confirmation_archive_stage',
  'vote_archive_stage',
  DELEGATION_ARCHIVE_STAGE,
];
