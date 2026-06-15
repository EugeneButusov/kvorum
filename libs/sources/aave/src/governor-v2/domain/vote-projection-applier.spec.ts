import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AaveGovernorV2VoteProjectionApplier } from './vote-projection-applier';
import type { AaveGovernorV2VoteProjectionApplierDeps } from './vote-projection-applier';
import type { AaveGovernorV2ArchivePayloadRow } from '../persistence/archive-payload-repository';

const VOTER = '0x' + 'ab'.repeat(20);
const PROPOSAL_DB_ID = 'proposal-db-id-1';
const DAO_ID = 'dao-id-1';
const CAST_AT = new Date('2021-01-10T00:00:00Z');

const BASE_ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_governor_v2',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '12000000',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'VoteEmitted',
  received_at: new Date('2021-01-10T00:00:00Z'),
  derivation_attempt_count: 0,
};

const BASE_PAYLOAD: AaveGovernorV2ArchivePayloadRow = {
  chain_id: '0x1',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'VoteEmitted',
  payload: JSON.stringify({
    id: '5',
    voter: VOTER,
    support: true,
    votingPower: '1000000000000000000',
  }),
  received_at: new Date('2021-01-10T00:00:00Z'),
};

function makeDeps(
  overrides: Partial<AaveGovernorV2VoteProjectionApplierDeps> = {},
): AaveGovernorV2VoteProjectionApplierDeps {
  return {
    archive: {
      markDerived: vi.fn().mockResolvedValue(undefined),
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    } as never,
    dlq: { insert: vi.fn().mockResolvedValue({ id: 'dlq-1' }) } as never,
    payloads: {
      fetchPayloads: vi.fn().mockResolvedValue([BASE_PAYLOAD]),
    } as never,
    proposals: {
      findDaoIdForSource: vi.fn().mockResolvedValue(DAO_ID),
      findBySource: vi.fn().mockResolvedValue({ id: PROPOSAL_DB_ID }),
    } as never,
    voteRead: {
      findCurrentVote: vi.fn().mockResolvedValue(undefined),
    } as never,
    voteWrite: {
      insertBatch: vi.fn().mockResolvedValue(undefined),
    } as never,
    metrics: {
      batchLookupSeconds: vi.fn(),
      chWriteSeconds: vi.fn(),
      processed: vi.fn(),
    },
    registry: {
      peek: vi.fn().mockReturnValue({ client: {}, chainCfg: { chainId: '0x1' } }),
    } as never,
    ...overrides,
  } as AaveGovernorV2VoteProjectionApplierDeps & {
    archive: { markDerived: ReturnType<typeof vi.fn> };
  };
}

function makeApplier(deps: AaveGovernorV2VoteProjectionApplierDeps) {
  const applier = new AaveGovernorV2VoteProjectionApplier(deps);
  // Inject a mock blockTimestamps fetcher
  const blockTimestamps = {
    fetchBatch: vi.fn().mockResolvedValue(new Map([['12000000:0xblock', CAST_AT]])),
    resultKey: (blockNumber: string, blockHash: string) => `${blockNumber}:${blockHash}`,
  };
  (applier as unknown as { blockTimestamps: typeof blockTimestamps }).blockTimestamps =
    blockTimestamps;
  return applier;
}

describe('AaveGovernorV2VoteProjectionApplier', () => {
  it('has kind projection, sourceTypes [aave_governor_v2], eventTypes [VoteEmitted]', () => {
    const applier = new AaveGovernorV2VoteProjectionApplier(makeDeps());
    expect(applier.kind).toBe('projection');
    expect(applier.sourceTypes).toEqual(['aave_governor_v2']);
    expect(applier.eventTypes).toEqual(['VoteEmitted']);
  });

  it('derives vote with primaryChoice=1 for support=true', async () => {
    const deps = makeDeps();
    const applier = makeApplier(deps);

    await applier.applyBatch([BASE_ROW]);

    expect(deps.voteWrite.insertBatch).toHaveBeenCalled();
    const rows = (deps.voteWrite.insertBatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | Array<{ primary_choice: number; voting_power: string }>
      | undefined;
    expect(rows).toBeDefined();
    expect(rows?.some((r) => r.primary_choice === 1)).toBe(true);
    expect(rows?.some((r) => r.voting_power === '1000000000000000000')).toBe(true);
  });

  it('derives vote with primaryChoice=0 for support=false', async () => {
    const deps = makeDeps();
    deps.payloads = {
      fetchPayloads: vi.fn().mockResolvedValue([
        {
          ...BASE_PAYLOAD,
          payload: JSON.stringify({ id: '5', voter: VOTER, support: false, votingPower: '500' }),
        },
      ]),
    } as never;
    const applier = makeApplier(deps);

    await applier.applyBatch([BASE_ROW]);

    expect(deps.voteWrite.insertBatch).toHaveBeenCalled();
    const rows = (deps.voteWrite.insertBatch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Array<{ primary_choice: number }>;
    expect(rows?.some((r) => r.primary_choice === 0)).toBe(true);
  });

  it('marks derived on success', async () => {
    const deps = makeDeps();
    const applier = makeApplier(deps);

    await applier.applyBatch([BASE_ROW]);

    expect(deps.archive.markDerived).toHaveBeenCalledWith('archive-1');
  });

  it('skips_idempotent when current.vote_id equals row.id', async () => {
    const deps = makeDeps({
      voteRead: {
        findCurrentVote: vi
          .fn()
          .mockResolvedValue({ vote_id: 'archive-1', voting_chain_id: '0x1' }),
      } as never,
    });
    const applier = makeApplier(deps);

    await applier.applyBatch([BASE_ROW]);

    expect(deps.voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(deps.archive.markDerived).toHaveBeenCalled();
    expect((deps.metrics.processed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      outcome: 'skipped_idempotent',
    });
  });

  it('fails with no_proposal when proposal not found', async () => {
    const deps = makeDeps({
      proposals: {
        findDaoIdForSource: vi.fn().mockResolvedValue(DAO_ID),
        findBySource: vi.fn().mockResolvedValue(undefined),
      } as never,
    });
    const applier = makeApplier(deps);

    await applier.applyBatch([BASE_ROW]);

    expect(deps.voteWrite.insertBatch).not.toHaveBeenCalled();
    expect((deps.metrics.processed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      outcome: 'failed',
      reason: 'no_proposal',
    });
  });

  it('fails with payload_missing when payload not found in CH', async () => {
    const deps = makeDeps({
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([]) } as never,
    });
    const applier = makeApplier(deps);

    await applier.applyBatch([BASE_ROW]);

    expect(deps.voteWrite.insertBatch).not.toHaveBeenCalled();
    expect((deps.metrics.processed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      outcome: 'failed',
      reason: 'payload_missing',
    });
  });

  it('fails with block_timestamp_unavailable when chain context missing', async () => {
    const deps = makeDeps({
      registry: { peek: vi.fn().mockReturnValue(undefined) } as never,
    });
    // Don't inject mock blockTimestamps — let it fail at chain ctx check
    const applier = new AaveGovernorV2VoteProjectionApplier(deps);

    await applier.applyBatch([BASE_ROW]);

    expect((deps.metrics.processed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      outcome: 'failed',
      reason: 'block_timestamp_unavailable',
    });
  });

  it('returns early without error on empty batch', async () => {
    const deps = makeDeps();
    const applier = new AaveGovernorV2VoteProjectionApplier(deps);

    await expect(applier.applyBatch([])).resolves.toBeUndefined();
    expect(deps.payloads.fetchPayloads).not.toHaveBeenCalled();
  });
});
