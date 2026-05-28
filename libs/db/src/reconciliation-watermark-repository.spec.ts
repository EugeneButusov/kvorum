import { describe, expect, it, vi } from 'vitest';
import { ReconciliationWatermarkRepository } from './reconciliation-watermark-repository';

function makeSelectChain(returnValue: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    selectAll: vi.fn(),
    where: vi.fn(),
    execute,
    executeTakeFirst,
  };
  chain.selectAll.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('ReconciliationWatermarkRepository', () => {
  it('find maps db row to bigint cursor', async () => {
    const row = {
      sweep_name: 'pg_orphan',
      dao_source_id: 'source-1',
      last_swept_block_number: '123',
      last_swept_tx_hash: '0xtx',
      last_swept_log_index: 7,
      last_sweep_at: new Date('2026-01-01T00:00:00Z'),
    };
    const { selectFrom } = makeSelectChain(row);
    const repo = new ReconciliationWatermarkRepository({ selectFrom } as never);

    const out = await repo.find('pg_orphan', 'source-1');
    expect(out?.blockNumber).toBe(123n);
    expect(out?.txHash).toBe('0xtx');
    expect(out?.logIndex).toBe(7);
  });

  it('findAll maps all rows', async () => {
    const rows = [
      {
        sweep_name: 'ch_orphan',
        dao_source_id: 'source-1',
        last_swept_block_number: '11',
        last_swept_tx_hash: '',
        last_swept_log_index: 0,
        last_sweep_at: null,
      },
      {
        sweep_name: 'ch_orphan',
        dao_source_id: 'source-2',
        last_swept_block_number: '12',
        last_swept_tx_hash: '',
        last_swept_log_index: 0,
        last_sweep_at: null,
      },
    ];
    const { selectFrom } = makeSelectChain(rows);
    const repo = new ReconciliationWatermarkRepository({ selectFrom } as never);

    const out = await repo.findAll('ch_orphan');
    expect(out).toHaveLength(2);
    expect(out[1]?.blockNumber).toBe(12n);
  });
});
