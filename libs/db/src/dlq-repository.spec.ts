import { describe, it, expect, vi } from 'vitest';
import type { NewIngestionDlq } from './schema/pg';
import { DlqRepository } from './dlq-repository';

const DLQ_ROW: NewIngestionDlq = {
  stage: 'archive_confirmation_write',
  source: 'compound_governor',
  payload: { raw: { topics: [], data: '0x' }, block_number: '20000000' },
  error: { name: 'Error', message: 'boom' },
  retries: 3,
  first_seen_at: new Date('2026-01-01T00:00:00Z'),
  last_attempt_at: new Date('2026-01-01T00:00:01Z'),
  archive_source_type: 'compound_governor',
  archive_chain_id: 1,
  archive_tx_hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
  archive_log_index: 3,
  archive_block_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
};

function makeInsertChain(opts: { throws?: unknown } = {}) {
  const execute = opts.throws
    ? vi.fn().mockRejectedValue(opts.throws)
    : vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ execute });
  const insertInto = vi.fn().mockReturnValue({ values });
  return { insertInto, values, execute };
}

describe('DlqRepository', () => {
  it('#1 — inserts into ingestion_dlq with the provided row', async () => {
    const chain = makeInsertChain();
    const repo = new DlqRepository({ insertInto: chain.insertInto } as never);

    await repo.insert(DLQ_ROW);

    expect(chain.insertInto).toHaveBeenCalledWith('ingestion_dlq');
    expect(chain.values).toHaveBeenCalledWith(DLQ_ROW);
    expect(chain.execute).toHaveBeenCalledOnce();
  });

  it('#2 — propagates PG errors', async () => {
    const pgErr = new Error('PG unreachable');
    const chain = makeInsertChain({ throws: pgErr });
    const repo = new DlqRepository({ insertInto: chain.insertInto } as never);

    await expect(repo.insert(DLQ_ROW)).rejects.toThrow('PG unreachable');
  });
});
