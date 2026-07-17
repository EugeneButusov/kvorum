import { describe, it, expect, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AAVE_IPFS_TITLE_FETCH_STAGE, insertIpfsTitleDlq } from './ipfs-title-dlq';

function makeRow(): ArchiveDerivationRow {
  return {
    id: 'archive-1',
    source_type: 'aave_governor_v2',
    dao_source_id: 'dao-source-1',
    chain_id: '0x1',
    block_number: '13419950',
    block_hash: '0xblockhash',
    tx_hash: '0xtxhash',
    log_index: 232,
    event_type: 'ProposalCreated',
    received_at: new Date('2026-07-15T02:30:15.000Z'),
    derivation_attempt_count: 0,
  } as unknown as ArchiveDerivationRow;
}

/** A Kysely double whose insert either lands (returns a row) or hits ON CONFLICT DO NOTHING (returns undefined). */
function makeTx(opts: { insertReturns?: { id: string }; existingId?: string }) {
  const insertChain = {
    values: vi.fn(),
    onConflict: vi.fn(),
    returning: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(opts.insertReturns),
  };
  insertChain.values.mockReturnValue(insertChain);
  insertChain.onConflict.mockReturnValue(insertChain);
  insertChain.returning.mockReturnValue(insertChain);

  const selectChain = {
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ id: opts.existingId }),
  };
  selectChain.select.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);

  const tx = {
    insertInto: vi.fn().mockReturnValue(insertChain),
    selectFrom: vi.fn().mockReturnValue(selectChain),
  };
  return { tx, insertChain, selectChain };
}

const OPTS = {
  proposalId: 'proposal-1',
  descriptionHash: 'QmDescriptionHash',
  source: 'indexer.aave_governor_v2',
};

describe('insertIpfsTitleDlq', () => {
  it('#1 — returns the new entry id when the insert lands', async () => {
    const { tx, selectChain } = makeTx({ insertReturns: { id: 'dlq-new' } });

    expect(await insertIpfsTitleDlq(tx as never, makeRow(), OPTS)).toBe('dlq-new');
    // No conflict → no lookup needed.
    expect(selectChain.executeTakeFirstOrThrow).not.toHaveBeenCalled();
  });

  it('#2 — reuses the already-parked entry id instead of throwing (the prod stall)', async () => {
    // A stale DLQ row exists for this (archive tuple, stage) — e.g. archive_event/proposal were
    // wiped for a re-backfill but ingestion_dlq was left intact. DO NOTHING returns no row.
    const { tx, selectChain } = makeTx({ insertReturns: undefined, existingId: 'dlq-stale' });

    expect(await insertIpfsTitleDlq(tx as never, makeRow(), OPTS)).toBe('dlq-stale');
    expect(tx.selectFrom).toHaveBeenCalledWith('ingestion_dlq');
    expect(selectChain.executeTakeFirstOrThrow).toHaveBeenCalled();
  });

  it('#3 — inserts with ON CONFLICT DO NOTHING so a stale row can never abort the transaction', async () => {
    const { tx, insertChain } = makeTx({ insertReturns: { id: 'dlq-new' } });
    await insertIpfsTitleDlq(tx as never, makeRow(), OPTS);

    expect(insertChain.onConflict).toHaveBeenCalledTimes(1);
    const build = insertChain.onConflict.mock.calls[0]?.[0] as (oc: unknown) => unknown;
    const oc = { doNothing: vi.fn().mockReturnValue('DO_NOTHING') };
    expect(build(oc)).toBe('DO_NOTHING');
    expect(oc.doNothing).toHaveBeenCalled();
  });

  it('#4 — parks under the ipfs-title stage with the archive tuple and enrichment payload', async () => {
    const { tx, insertChain } = makeTx({ insertReturns: { id: 'dlq-new' } });
    await insertIpfsTitleDlq(tx as never, makeRow(), OPTS);

    expect(tx.insertInto).toHaveBeenCalledWith('ingestion_dlq');
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: AAVE_IPFS_TITLE_FETCH_STAGE,
        source: 'indexer.aave_governor_v2',
        retries: 0,
        archive_source_type: 'aave_governor_v2',
        archive_chain_id: '0x1',
        archive_tx_hash: '0xtxhash',
        archive_log_index: 232,
        archive_block_hash: '0xblockhash',
        payload: {
          proposal_id: 'proposal-1',
          ipfs_hash: 'QmDescriptionHash',
          dao_source_id: 'dao-source-1',
        },
      }),
    );
  });

  it('#5 — looks the existing entry up by the full (archive tuple, stage) unique key', async () => {
    const { tx, selectChain } = makeTx({ insertReturns: undefined, existingId: 'dlq-stale' });
    await insertIpfsTitleDlq(tx as never, makeRow(), OPTS);

    // Must match idx_ingestion_dlq_archive_tuple_stage exactly, or we could reuse a foreign entry.
    expect(selectChain.where).toHaveBeenCalledWith('archive_source_type', '=', 'aave_governor_v2');
    expect(selectChain.where).toHaveBeenCalledWith('archive_chain_id', '=', '0x1');
    expect(selectChain.where).toHaveBeenCalledWith('archive_tx_hash', '=', '0xtxhash');
    expect(selectChain.where).toHaveBeenCalledWith('archive_log_index', '=', 232);
    expect(selectChain.where).toHaveBeenCalledWith('archive_block_hash', '=', '0xblockhash');
    expect(selectChain.where).toHaveBeenCalledWith('stage', '=', AAVE_IPFS_TITLE_FETCH_STAGE);
  });

  it('#6 — carries the caller-supplied source (v2 and v3 park under the same stage)', async () => {
    const { tx, insertChain } = makeTx({ insertReturns: { id: 'dlq-new' } });
    await insertIpfsTitleDlq(tx as never, makeRow(), {
      ...OPTS,
      source: 'indexer.aave_governance_v3',
    });

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'indexer.aave_governance_v3' }),
    );
  });
});
