import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestionDlq } from '@libs/db';
import { AaveIpfsTitleStageAdapter } from './aave-ipfs-title-stage-adapter.js';

const DLQ_ROW: IngestionDlq = {
  id: 'dlq-1',
  stage: 'aave_ipfs_title_fetch',
  source: 'indexer.aave_governance_v3',
  payload: {
    proposal_id: 'proposal-1',
    ipfs_hash: '12'.repeat(32),
    dao_source_id: 'source-1',
  },
  error: { message: 'awaiting ipfs title fetch' },
  retries: 0,
  first_seen_at: new Date('2026-01-01T00:00:00Z'),
  last_attempt_at: new Date('2026-01-01T00:00:00Z'),
  archive_source_type: 'aave_governance_v3',
  archive_chain_id: '0x1',
  archive_tx_hash: '0x' + '1'.repeat(64),
  archive_log_index: 0,
  archive_block_hash: '0x' + '2'.repeat(64),
};

describe('AaveIpfsTitleStageAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('updates the proposal when the title fetch succeeds', async () => {
    const fetcher = {
      fetchTitleDescription: vi.fn().mockResolvedValue({
        kind: 'resolved',
        title: 'Loaded title',
        description: 'Loaded body',
      }),
    };
    const proposals = {
      updateTitleDescription: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new AaveIpfsTitleStageAdapter({ fetcher, proposals });

    await expect(adapter.retry(DLQ_ROW)).resolves.toEqual({
      status: 'resolved',
      reason: 'aave ipfs title re-fetch succeeded',
    });

    expect(fetcher.fetchTitleDescription).toHaveBeenCalledWith('12'.repeat(32));
    expect(proposals.updateTitleDescription).toHaveBeenCalledWith(
      'proposal-1',
      'Loaded title',
      'Loaded body',
    );
  });

  it('resolves without updating the proposal when no usable title exists', async () => {
    const fetcher = {
      fetchTitleDescription: vi.fn().mockResolvedValue({ kind: 'no_title' }),
    };
    const proposals = {
      updateTitleDescription: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new AaveIpfsTitleStageAdapter({ fetcher, proposals });

    await expect(adapter.retry(DLQ_ROW)).resolves.toEqual({
      status: 'resolved',
      reason: 'aave ipfs title unavailable; placeholder retained',
    });

    expect(proposals.updateTitleDescription).not.toHaveBeenCalled();
  });

  it('throws when the fetch still fails so the row remains in DLQ', async () => {
    const adapter = new AaveIpfsTitleStageAdapter({
      fetcher: {
        fetchTitleDescription: vi.fn().mockResolvedValue({ kind: 'error', reason: 'timeout' }),
      },
      proposals: {
        updateTitleDescription: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(adapter.retry(DLQ_ROW)).rejects.toThrow(
      'aave ipfs title re-fetch failed: timeout',
    );
  });
});
