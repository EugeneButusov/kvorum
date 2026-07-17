import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ProposalRepository,
} from '@libs/db';
import { AaveGovernorV2ProjectionApplier } from './governor-v2-projection-applier';
import { AaveProposalRepository } from '../../persistence/aave-proposal-repository';
import type { AaveGovernorV2ArchivePayloadRow } from '../persistence/archive-payload-repository';

const CREATOR = '0x' + 'ab'.repeat(20);
const EXECUTOR = '0x' + 'cc'.repeat(20);
const TARGET = '0x' + 'dd'.repeat(20);
const STRATEGY = '0x' + 'ee'.repeat(20);
const IPFS_HASH = '0x' + '12'.repeat(32);

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_governor_v2',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '11500000',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'ProposalCreated',
  received_at: new Date('2021-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const CREATED_PAYLOAD: AaveGovernorV2ArchivePayloadRow = {
  chain_id: '0x1',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'ProposalCreated',
  payload: JSON.stringify({
    id: '5',
    creator: CREATOR,
    executor: EXECUTOR,
    targets: [TARGET],
    values: ['0'],
    signatures: ['transfer(address,uint256)'],
    calldatas: ['0xdata'],
    withDelegatecalls: [false],
    startBlock: '11510000',
    endBlock: '11540000',
    strategy: STRATEGY,
    ipfsHash: IPFS_HASH,
  }),
  received_at: new Date('2021-01-01T00:00:00Z'),
};

const QUEUED_PAYLOAD: AaveGovernorV2ArchivePayloadRow = {
  ...CREATED_PAYLOAD,
  event_type: 'ProposalQueued',
  payload: JSON.stringify({ id: '5', executionTime: '1611000000' }),
};

function makeMetrics() {
  return {
    batchLookupSeconds: vi.fn(),
    processed: vi.fn(),
    ipfsTitleFetch: vi.fn(),
  };
}

function makeProjectionTx(
  options: {
    proposalInserted?: boolean;
    advanceStateRows?: number;
    existingProposal?: { id: string; source_id: string } | undefined;
  } = {},
) {
  const calls = {
    insertedProposal: undefined as unknown,
    insertedChoices: undefined as unknown,
    insertedMetadata: undefined as unknown,
    insertedDlq: undefined as unknown,
    markedDerivedId: undefined as string | undefined,
    markedActorResolvedId: undefined as string | undefined,
    transactionCount: 0,
  };
  const proposalInserted = options.proposalInserted ?? true;
  const advanceStateRows = options.advanceStateRows ?? 1;
  const existingProposal = options.existingProposal;

  function chain<T extends object>(methods: T): T {
    return methods;
  }

  const tx = {
    selectFrom: vi.fn((table: string) => {
      if (table === 'dao_source') {
        return chain({
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn().mockResolvedValue({ dao_id: 'dao-1' }),
        });
      }
      if (table === 'proposal') {
        return chain({
          selectAll: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn().mockResolvedValue(existingProposal),
        });
      }
      return chain({
        selectAll: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(undefined),
      });
    }),
    insertInto: vi.fn((table: string) => {
      const chainObj = {
        values: vi.fn(function (this: unknown, values: unknown) {
          if (table === 'proposal') calls.insertedProposal = values;
          if (table === 'proposal_choice') calls.insertedChoices = values;
          if (table === 'aave_proposal_metadata') calls.insertedMetadata = values;
          if (table === 'ingestion_dlq') calls.insertedDlq = values;
          return this;
        }),
        onConflict: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnThis(),
        returningAll: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn(async () => {
          if (table === 'actor') return { id: 'actor-1' };
          if (table === 'proposal') return proposalInserted ? { id: 'proposal-1' } : undefined;
          if (table === 'ingestion_dlq') return { id: 'dlq-1' };
          return undefined;
        }),
        executeTakeFirstOrThrow: vi.fn(async () => {
          if (table === 'ingestion_dlq') return { id: 'dlq-1' };
          throw new Error(`unexpected executeTakeFirstOrThrow on ${table}`);
        }),
        execute: vi.fn().mockResolvedValue(undefined),
      };
      return chainObj;
    }),
    updateTable: vi.fn((table: string) => {
      let lastArchiveSet: 'derived' | 'actor_resolved' | undefined;
      const updateChain = chain({
        set: vi.fn((values: Record<string, unknown>) => {
          if (table === 'archive_event') {
            if ('derivation_actor_resolved_at' in values) lastArchiveSet = 'actor_resolved';
            if ('derived_at' in values) lastArchiveSet = 'derived';
          }
          return updateChain;
        }),
        where: vi.fn((_column: string, _operator: string, value: unknown) => {
          if (table === 'archive_event') {
            if (lastArchiveSet === 'actor_resolved') calls.markedActorResolvedId = String(value);
            if (lastArchiveSet === 'derived') calls.markedDerivedId = String(value);
          }
          return updateChain;
        }),
        execute: vi.fn().mockResolvedValue(undefined),
        executeTakeFirst: vi.fn(async () => {
          if (table === 'proposal') return { numUpdatedRows: BigInt(advanceStateRows) };
          return undefined;
        }),
      });
      return updateChain;
    }),
  };

  const pgDb = {
    selectFrom: tx.selectFrom,
    transaction: vi.fn(() => ({
      execute: vi.fn((fn: (arg: typeof tx) => Promise<unknown>) => {
        calls.transactionCount += 1;
        return fn(tx);
      }),
    })),
  };

  return { pgDb, tx, calls };
}

describe('AaveGovernorV2ProjectionApplier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has kind projection, sourceTypes [aave_governor_v2], eventTypes cover proposal lifecycle', () => {
    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: makeProjectionTx().pgDb as never,
      archive: {} as never,
      dlq: {} as never,
      payloads: {} as never,
      ipfsFetcher: {} as never,
      metrics: makeMetrics(),
    });
    expect(applier.kind).toBe('projection');
    expect(applier.sourceTypes).toEqual(['aave_governor_v2']);
    expect(applier.eventTypes).toEqual([
      'ProposalCreated',
      'ProposalQueued',
      'ProposalExecuted',
      'ProposalCanceled',
    ]);
  });

  it('projects ProposalCreated, inserts title DLQ, and enriches title after commit', async () => {
    const { pgDb, calls } = makeProjectionTx();
    const metrics = makeMetrics();
    const markRetrySucceeded = vi.fn().mockResolvedValue('resolved');
    const insertProposal = vi
      .spyOn(ProposalRepository.prototype, 'insertProposal')
      .mockResolvedValue({ inserted: true, proposalId: 'proposal-1' });
    const insertMetadata = vi
      .spyOn(AaveProposalRepository.prototype, 'insertMetadata')
      .mockResolvedValue(undefined);
    const ensureChoices = vi
      .spyOn(ProposalRepository.prototype, 'ensureChoices')
      .mockResolvedValue(undefined);
    const updateTitleDescription = vi
      .spyOn(ProposalRepository.prototype, 'updateTitleDescription')
      .mockResolvedValue(undefined);
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(ActorRepository.prototype, 'findOrCreateActorAddress').mockResolvedValue({
      id: 'actor-1',
    } as never);
    const markDerived = vi
      .spyOn(ArchiveDerivationRepository.prototype, 'markDerived')
      .mockResolvedValue(undefined);
    const markActorResolved = vi
      .spyOn(ArchiveActorResolutionRepository.prototype, 'markActorResolved')
      .mockResolvedValue(undefined);
    vi.spyOn(ProposalRepository.prototype, 'insertActions').mockResolvedValue(undefined);

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: pgDb as never,
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([CREATED_PAYLOAD]) } as never,
      ipfsFetcher: {
        fetchTitleDescription: vi
          .fn()
          .mockResolvedValue({ kind: 'resolved', title: 'AIP-5 Title', description: 'Body' }),
      } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([ROW]);

    expect(insertProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        dao_id: 'dao-1',
        proposer_actor_id: 'actor-1',
        source_id: '5',
        title: 'Proposal #5',
        description_hash: '12'.repeat(32),
        voting_starts_block: '11510000',
        voting_ends_block: '11540000',
      }),
    );
    expect(insertMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal_id: 'proposal-1',
        voting_chain_id: '0x1',
        voting_machine_address: null,
        voting_strategy_address: STRATEGY,
        creation_block: '11500000',
      }),
    );
    expect(ensureChoices).toHaveBeenCalledWith(
      'proposal-1',
      expect.arrayContaining([
        { proposal_id: '', choice_index: 0, value: 'against' },
        { proposal_id: '', choice_index: 1, value: 'for' },
      ]),
    );
    expect(calls.insertedDlq).toEqual(
      expect.objectContaining({
        stage: 'aave_ipfs_title_fetch',
        source: 'indexer.aave_governor_v2',
      }),
    );
    expect(updateTitleDescription).toHaveBeenCalledWith('proposal-1', 'AIP-5 Title', 'Body');
    expect(markRetrySucceeded).toHaveBeenCalledWith(
      'dlq-1',
      'ipfs title resolved during projection',
      'indexer.aave_governor_v2',
    );
    expect(metrics.ipfsTitleFetch).toHaveBeenCalledWith('resolved');
    expect(markDerived).toHaveBeenCalledWith('archive-1');
    expect(markActorResolved).toHaveBeenCalledWith('archive-1');
  });

  it('keeps the placeholder title and resolves the DLQ row on no_title', async () => {
    const { pgDb } = makeProjectionTx();
    const metrics = makeMetrics();
    const markRetrySucceeded = vi.fn().mockResolvedValue('resolved');
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(ActorRepository.prototype, 'findOrCreateActorAddress').mockResolvedValue({
      id: 'actor-1',
    } as never);
    vi.spyOn(ProposalRepository.prototype, 'insertProposal').mockResolvedValue({
      inserted: true,
      proposalId: 'proposal-1',
    });
    vi.spyOn(AaveProposalRepository.prototype, 'insertMetadata').mockResolvedValue(undefined);
    vi.spyOn(ProposalRepository.prototype, 'ensureChoices').mockResolvedValue(undefined);
    vi.spyOn(ProposalRepository.prototype, 'insertActions').mockResolvedValue(undefined);
    vi.spyOn(ArchiveDerivationRepository.prototype, 'markDerived').mockResolvedValue(undefined);
    vi.spyOn(ArchiveActorResolutionRepository.prototype, 'markActorResolved').mockResolvedValue(
      undefined,
    );

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: pgDb as never,
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([CREATED_PAYLOAD]) } as never,
      ipfsFetcher: {
        fetchTitleDescription: vi.fn().mockResolvedValue({ kind: 'no_title' }),
      } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([ROW]);

    expect(markRetrySucceeded).toHaveBeenCalledWith(
      'dlq-1',
      'ipfs fetch completed without usable title; placeholder retained',
      'indexer.aave_governor_v2',
    );
    expect(metrics.ipfsTitleFetch).toHaveBeenCalledWith('fallback_title');
  });

  it('leaves the DLQ row unresolved when the IPFS fetch errors', async () => {
    const { pgDb } = makeProjectionTx();
    const metrics = makeMetrics();
    const markRetrySucceeded = vi.fn();
    const logger = { warn: vi.fn(), error: vi.fn() };
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(ActorRepository.prototype, 'findOrCreateActorAddress').mockResolvedValue({
      id: 'actor-1',
    } as never);
    vi.spyOn(ProposalRepository.prototype, 'insertProposal').mockResolvedValue({
      inserted: true,
      proposalId: 'proposal-1',
    });
    vi.spyOn(AaveProposalRepository.prototype, 'insertMetadata').mockResolvedValue(undefined);
    vi.spyOn(ProposalRepository.prototype, 'ensureChoices').mockResolvedValue(undefined);
    vi.spyOn(ProposalRepository.prototype, 'insertActions').mockResolvedValue(undefined);
    vi.spyOn(ArchiveDerivationRepository.prototype, 'markDerived').mockResolvedValue(undefined);
    vi.spyOn(ArchiveActorResolutionRepository.prototype, 'markActorResolved').mockResolvedValue(
      undefined,
    );

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: pgDb as never,
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([CREATED_PAYLOAD]) } as never,
      ipfsFetcher: {
        fetchTitleDescription: vi.fn().mockResolvedValue({ kind: 'error', reason: 'timeout' }),
      } as never,
      metrics,
      logger: logger as never,
    });

    await applier.applyBatch([ROW]);

    expect(markRetrySucceeded).not.toHaveBeenCalled();
    expect(metrics.ipfsTitleFetch).toHaveBeenCalledWith('dlq');
    expect(logger.warn).toHaveBeenCalledWith(
      'aave_v2_ipfs_title_fetch_failed',
      expect.objectContaining({ proposal_id: 'proposal-1', dlq_id: 'dlq-1' }),
    );
  });

  it('treats duplicate ProposalCreated rows as idempotent and skips post-commit enrichment', async () => {
    const { pgDb } = makeProjectionTx({ proposalInserted: false });
    const metrics = makeMetrics();
    const fetchTitleDescription = vi.fn();
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(ActorRepository.prototype, 'findOrCreateActorAddress').mockResolvedValue({
      id: 'actor-1',
    } as never);
    vi.spyOn(ProposalRepository.prototype, 'insertProposal').mockResolvedValue({
      inserted: false,
    });
    vi.spyOn(ProposalRepository.prototype, 'insertActions').mockResolvedValue(undefined);
    const insertMetadata = vi
      .spyOn(AaveProposalRepository.prototype, 'insertMetadata')
      .mockResolvedValue(undefined);
    const ensureChoices = vi
      .spyOn(ProposalRepository.prototype, 'ensureChoices')
      .mockResolvedValue(undefined);
    const markDerived = vi
      .spyOn(ArchiveDerivationRepository.prototype, 'markDerived')
      .mockResolvedValue(undefined);
    const markActorResolved = vi
      .spyOn(ArchiveActorResolutionRepository.prototype, 'markActorResolved')
      .mockResolvedValue(undefined);

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: pgDb as never,
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([CREATED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([ROW]);

    expect(insertMetadata).not.toHaveBeenCalled();
    expect(ensureChoices).not.toHaveBeenCalled();
    expect(fetchTitleDescription).not.toHaveBeenCalled();
    expect(markDerived).toHaveBeenCalledWith('archive-1');
    expect(markActorResolved).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_idempotent', reason: null }),
    );
  });

  it.each([
    ['ProposalQueued', QUEUED_PAYLOAD, 'queued'],
    [
      'ProposalExecuted',
      { ...CREATED_PAYLOAD, event_type: 'ProposalExecuted', payload: JSON.stringify({ id: '5' }) },
      'executed',
    ],
    [
      'ProposalCanceled',
      { ...CREATED_PAYLOAD, event_type: 'ProposalCanceled', payload: JSON.stringify({ id: '5' }) },
      'canceled',
    ],
  ] as const)('advances %s state transition and records derived', async (eventType, payloadRow) => {
    const { pgDb, calls } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '5' },
    });
    const metrics = makeMetrics();

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: pgDb as never,
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([payloadRow]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: eventType }]);

    expect(calls.markedDerivedId).toBe('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null, event_type: eventType }),
    );
  });

  it('records skipped_state_guard when a state transition advances zero rows', async () => {
    const { pgDb } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '5' },
      advanceStateRows: 0,
    });
    const metrics = makeMetrics();

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: pgDb as never,
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([QUEUED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'ProposalQueued' }]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_state_guard', reason: null }),
    );
  });

  it('increments attempt count and fails with no_proposal when proposal not found', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const metrics = makeMetrics();
    const logger = { warn: vi.fn(), error: vi.fn() };

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: makeProjectionTx({ existingProposal: undefined }).pgDb as never,
      archive: archive as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([QUEUED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: logger as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'ProposalQueued' }]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'no_proposal' }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'aave_v2_derivation_failed',
      expect.objectContaining({ reason: 'no_proposal' }),
    );
  });

  it('increments attempt count when the archive payload is missing', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const metrics = makeMetrics();
    const logger = { warn: vi.fn(), error: vi.fn() };

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: makeProjectionTx().pgDb as never,
      archive: archive as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: logger as never,
    });

    await applier.applyBatch([ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'payload_missing' }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'aave_v2_derivation_failed',
      expect.objectContaining({ reason: 'payload_missing' }),
    );
  });

  it('increments attempt count on decode errors from unsupported event types', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const metrics = makeMetrics();
    const logger = { warn: vi.fn(), error: vi.fn() };

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: makeProjectionTx().pgDb as never,
      archive: archive as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: {
        fetchPayloads: vi
          .fn()
          .mockResolvedValue([{ ...CREATED_PAYLOAD, event_type: 'VoteEmitted' as never }]),
      } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: logger as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'VoteEmitted' as never }]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'decode_error' }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'aave_v2_derivation_failed',
      expect.objectContaining({ reason: 'decode_error' }),
    );
  });

  it('increments attempt count on projection_apply_error from array length mismatch', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const metrics = makeMetrics();
    const logger = { warn: vi.fn(), error: vi.fn() };
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(ActorRepository.prototype, 'findOrCreateActorAddress').mockResolvedValue({
      id: 'actor-1',
    } as never);

    const mismatchedPayload: AaveGovernorV2ArchivePayloadRow = {
      ...CREATED_PAYLOAD,
      payload: JSON.stringify({
        id: '5',
        creator: CREATOR,
        executor: EXECUTOR,
        targets: [TARGET],
        values: ['0', '1'],
        signatures: ['sig'],
        calldatas: ['0xdata'],
        withDelegatecalls: [false],
        startBlock: '11510000',
        endBlock: '11540000',
        strategy: STRATEGY,
        ipfsHash: IPFS_HASH,
      }),
    };

    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: makeProjectionTx().pgDb as never,
      archive: archive as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([mismatchedPayload]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: logger as never,
    });

    await applier.applyBatch([ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'projection_apply_error' }),
    );
  });

  it('returns early on an empty batch without fetching payloads', async () => {
    const fetchPayloads = vi.fn();
    const applier = new AaveGovernorV2ProjectionApplier({
      pgDb: makeProjectionTx().pgDb as never,
      archive: {} as never,
      dlq: {} as never,
      payloads: { fetchPayloads } as never,
      ipfsFetcher: {} as never,
      metrics: makeMetrics(),
    });

    await expect(applier.applyBatch([])).resolves.toBeUndefined();
    expect(fetchPayloads).not.toHaveBeenCalled();
  });
});
