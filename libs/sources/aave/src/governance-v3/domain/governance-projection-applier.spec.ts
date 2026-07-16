import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ProposalRepository,
} from '@libs/db';
import { AaveGovernanceProjectionApplier } from './governance-projection-applier';
import { AaveProposalRepository } from '../../persistence/aave-proposal-repository';
import type { AaveGovernanceArchivePayloadRow } from '../persistence/archive-payload-repository';

/** Activation block 100 was mined at this instant — the anchor for the derived voting window. */
const ACTIVATION_BLOCK_TIME = new Date('2024-03-01T12:00:00Z');

/**
 * A ChainContextRegistry whose `eth_getBlockByHash` reports ACTIVATION_BLOCK_TIME for ROW's block.
 * VoteBlockTimestampFetcher cross-checks the returned hash and number against the request, so the
 * response must echo both or it is discarded as a mismatch.
 */
function makeRegistry(opts: { hasContext?: boolean } = {}) {
  if (opts.hasContext === false) return { peek: vi.fn().mockReturnValue(undefined) } as never;
  return {
    peek: vi.fn().mockReturnValue({
      chainCfg: { chainId: '0x1' },
      client: {
        send: vi.fn().mockResolvedValue({
          hash: '0xblock',
          number: '0x64',
          timestamp: '0x' + Math.floor(ACTIVATION_BLOCK_TIME.getTime() / 1000).toString(16),
        }),
      },
    }),
  } as never;
}

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_governance_v3',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'ProposalCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const CREATED_PAYLOAD: AaveGovernanceArchivePayloadRow = {
  chain_id: '0x1',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'ProposalCreated',
  payload: JSON.stringify({
    proposalId: '42',
    creator: '0x' + 'ab'.repeat(20),
    accessLevel: 2,
    ipfsHash: '0x' + '12'.repeat(32),
  }),
  received_at: new Date('2026-01-01T00:00:00Z'),
};

const ACTIVATED_PAYLOAD: AaveGovernanceArchivePayloadRow = {
  ...CREATED_PAYLOAD,
  event_type: 'VotingActivated',
  payload: JSON.stringify({
    proposalId: '42',
    snapshotBlockHash: '0x' + '34'.repeat(32),
    votingDuration: 123,
  }),
};

const PAYLOAD_SENT: AaveGovernanceArchivePayloadRow = {
  ...CREATED_PAYLOAD,
  event_type: 'PayloadSent',
  payload: JSON.stringify({
    proposalId: '42',
    payloadId: '9',
    payloadsController: '0x' + '22'.repeat(20),
    chainId: '137',
    payloadNumberOnProposal: '0',
    numberOfPayloadsOnProposal: '2',
  }),
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
    insertedPayload: undefined as unknown,
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
    transaction: vi.fn(() => ({
      execute: vi.fn((fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)),
    })),
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
          if (table === 'aave_proposal_payload') calls.insertedPayload = values;
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

describe('AaveGovernanceProjectionApplier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([CREATED_PAYLOAD]) } as never,
      ipfsFetcher: {
        fetchTitleDescription: vi
          .fn()
          .mockResolvedValue({ kind: 'resolved', title: 'Loaded title', description: 'Body' }),
      } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([ROW]);

    expect(insertProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        dao_id: 'dao-1',
        proposer_actor_id: 'actor-1',
        source_id: '42',
        title: 'Proposal #42',
        description_hash: '12'.repeat(32),
      }),
    );
    expect(insertMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal_id: 'proposal-1',
        voting_chain_id: null,
        voting_machine_address: null,
      }),
    );
    expect(ensureChoices).toHaveBeenCalledWith(
      'proposal-1',
      expect.arrayContaining([
        { proposal_id: '', choice_index: 0, value: 'Against' },
        { proposal_id: '', choice_index: 1, value: 'For' },
      ]),
    );
    expect(calls.insertedDlq).toEqual(
      expect.objectContaining({
        stage: 'aave_ipfs_title_fetch',
        source: 'indexer.aave_governance_v3',
      }),
    );
    expect(updateTitleDescription).toHaveBeenCalledWith('proposal-1', 'Loaded title', 'Body');
    expect(markRetrySucceeded).toHaveBeenCalledWith(
      'dlq-1',
      'ipfs title resolved during projection',
      'indexer.aave_ipfs_title_fetch',
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
    vi.spyOn(ArchiveDerivationRepository.prototype, 'markDerived').mockResolvedValue(undefined);
    vi.spyOn(ArchiveActorResolutionRepository.prototype, 'markActorResolved').mockResolvedValue(
      undefined,
    );

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
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
      'indexer.aave_ipfs_title_fetch',
    );
    expect(metrics.ipfsTitleFetch).toHaveBeenCalledWith('fallback_title');
  });

  it('leaves the DLQ row unresolved when the IPFS fetch errors', async () => {
    const { pgDb } = makeProjectionTx();
    const metrics = makeMetrics();
    const markRetrySucceeded = vi.fn().mockResolvedValue('resolved');
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
    vi.spyOn(ArchiveDerivationRepository.prototype, 'markDerived').mockResolvedValue(undefined);
    vi.spyOn(ArchiveActorResolutionRepository.prototype, 'markActorResolved').mockResolvedValue(
      undefined,
    );

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
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
    expect(logger.warn).toHaveBeenCalled();
  });

  it('treats duplicate ProposalCreated rows as idempotent and skips post-commit enrichment', async () => {
    const { pgDb } = makeProjectionTx({ proposalInserted: false });
    const metrics = makeMetrics();
    const markRetrySucceeded = vi.fn().mockResolvedValue('resolved');
    const fetchTitleDescription = vi.fn();
    vi.spyOn(ProposalRepository.prototype, 'findDaoIdForSource').mockResolvedValue('dao-1');
    vi.spyOn(ActorRepository.prototype, 'findOrCreateActorAddress').mockResolvedValue({
      id: 'actor-1',
    } as never);
    vi.spyOn(ProposalRepository.prototype, 'insertProposal').mockResolvedValue({
      inserted: false,
    });
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

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([CREATED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([ROW]);

    expect(insertMetadata).not.toHaveBeenCalled();
    expect(ensureChoices).not.toHaveBeenCalled();
    expect(fetchTitleDescription).not.toHaveBeenCalled();
    expect(markRetrySucceeded).not.toHaveBeenCalled();
    expect(markDerived).toHaveBeenCalledWith('archive-1');
    expect(markActorResolved).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_idempotent', reason: null }),
    );
  });

  it('advances active state on VotingActivated', async () => {
    const { pgDb, calls } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '42' },
    });
    const metrics = makeMetrics();

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([ACTIVATED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'VotingActivated' }]);

    expect(calls.markedDerivedId).toBe('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('derives the voting window from activation block time + votingDuration', async () => {
    const { pgDb } = makeProjectionTx({ existingProposal: { id: 'proposal-1', source_id: '42' } });
    const fillTimestamps = vi
      .spyOn(ProposalRepository.prototype, 'fillTimestamps')
      .mockResolvedValue(undefined);

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([ACTIVATED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics: makeMetrics(),
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'VotingActivated' }]);

    // Anchored on the BLOCK's time, never received_at — a backfilled row's received_at is the
    // backfill run, which would date every historical vote to the day we ingested it.
    expect(fillTimestamps).toHaveBeenCalledWith([
      {
        id: 'proposal-1',
        voting_starts_at: ACTIVATION_BLOCK_TIME,
        voting_ends_at: new Date(ACTIVATION_BLOCK_TIME.getTime() + 123 * 1000),
      },
    ]);
  });

  it('derives the voting window even when the state guard blocks the transition', async () => {
    // The retroactive case: a proposal already executed/canceled cannot advance back to active, so
    // advanceState reports 0 rows — but those are exactly the proposals whose window needs filling.
    const { pgDb } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '42' },
      advanceStateRows: 0,
    });
    const fillTimestamps = vi
      .spyOn(ProposalRepository.prototype, 'fillTimestamps')
      .mockResolvedValue(undefined);
    const metrics = makeMetrics();

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([ACTIVATED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'VotingActivated' }]);

    expect(fillTimestamps).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'proposal-1', voting_starts_at: ACTIVATION_BLOCK_TIME }),
    ]);
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_state_guard' }),
    );
  });

  it('retries VotingActivated when the activation block time cannot be resolved', async () => {
    const { pgDb } = makeProjectionTx({ existingProposal: { id: 'proposal-1', source_id: '42' } });
    const fillTimestamps = vi
      .spyOn(ProposalRepository.prototype, 'fillTimestamps')
      .mockResolvedValue(undefined);
    const incrementAttemptCount = vi.fn();
    const metrics = makeMetrics();

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry({ hasContext: false }),
      archive: { incrementAttemptCount } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([ACTIVATED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'VotingActivated' }]);

    // Retry rather than persist a wrong instant or silently skip the window forever.
    expect(fillTimestamps).not.toHaveBeenCalled();
    expect(incrementAttemptCount).toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'block_timestamp_unavailable' }),
    );
  });

  it('records skipped_state_guard when a state transition advances zero rows', async () => {
    const { pgDb } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '42' },
      advanceStateRows: 0,
    });
    const metrics = makeMetrics();

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: {
        fetchPayloads: vi.fn().mockResolvedValue([
          {
            ...CREATED_PAYLOAD,
            event_type: 'ProposalQueued',
            payload: JSON.stringify({ proposalId: '42', votesFor: '1', votesAgainst: '0' }),
          },
        ]),
      } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'ProposalQueued' }]);

    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_state_guard', reason: null }),
    );
  });

  it('inserts declared payload rows when the proposal exists', async () => {
    const { pgDb, calls } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '42' },
    });
    const hasActivePayloadsControllerSource = vi
      .spyOn(AaveProposalRepository.prototype, 'hasActivePayloadsControllerSource')
      .mockResolvedValue(true);
    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([PAYLOAD_SENT]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics: makeMetrics(),
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'PayloadSent' }]);

    expect(calls.insertedPayload).toEqual(
      expect.objectContaining({
        proposal_id: 'proposal-1',
        payload_index: 0,
        target_chain_id: '137',
        payload_id: '9',
        status: 'declared',
        unindexed_target_chain: false,
      }),
    );
    expect(hasActivePayloadsControllerSource).toHaveBeenCalledWith('dao-1', '137');
  });

  it('marks declared payload rows unindexed when no payload-controller source exists', async () => {
    const { pgDb, calls } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '42' },
    });
    vi.spyOn(
      AaveProposalRepository.prototype,
      'hasActivePayloadsControllerSource',
    ).mockResolvedValue(false);
    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([PAYLOAD_SENT]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics: makeMetrics(),
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'PayloadSent' }]);

    expect(calls.insertedPayload).toEqual(
      expect.objectContaining({
        proposal_id: 'proposal-1',
        unindexed_target_chain: true,
      }),
    );
  });

  it('memoizes payload-controller coverage checks per dao and target chain within a batch', async () => {
    const { pgDb } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '42' },
    });
    const hasActivePayloadsControllerSource = vi
      .spyOn(AaveProposalRepository.prototype, 'hasActivePayloadsControllerSource')
      .mockResolvedValue(true);
    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      registry: makeRegistry(),
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: {
        fetchPayloads: vi.fn().mockResolvedValue([
          PAYLOAD_SENT,
          {
            ...PAYLOAD_SENT,
            tx_hash: '0xtx-2',
            log_index: 2,
            payload: JSON.stringify({
              ...JSON.parse(PAYLOAD_SENT.payload),
              payloadId: '10',
              payloadNumberOnProposal: '1',
            }),
          },
        ]),
      } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics: makeMetrics(),
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([
      { ...ROW, event_type: 'PayloadSent' },
      { ...ROW, id: 'archive-2', tx_hash: '0xtx-2', log_index: 2, event_type: 'PayloadSent' },
    ]);

    expect(hasActivePayloadsControllerSource).toHaveBeenCalledTimes(1);
  });

  it('increments attempt count when a non-create event arrives before proposal creation', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const applier = new AaveGovernanceProjectionApplier({
      pgDb: makeProjectionTx({ existingProposal: undefined }).pgDb as never,
      registry: makeRegistry(),
      archive: archive as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([ACTIVATED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics: makeMetrics(),
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'VotingActivated' }]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
  });

  it('increments attempt count when the archive payload is missing', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const metrics = makeMetrics();
    const logger = { warn: vi.fn(), error: vi.fn() };
    const applier = new AaveGovernanceProjectionApplier({
      pgDb: makeProjectionTx().pgDb as never,
      registry: makeRegistry(),
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
      'aave_derivation_failed',
      expect.objectContaining({ reason: 'payload_missing' }),
    );
  });

  it('increments attempt count on decode errors from unsupported event types', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const metrics = makeMetrics();
    const logger = { warn: vi.fn(), error: vi.fn() };
    const applier = new AaveGovernanceProjectionApplier({
      pgDb: makeProjectionTx().pgDb as never,
      registry: makeRegistry(),
      archive: archive as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: {
        fetchPayloads: vi
          .fn()
          .mockResolvedValue([{ ...CREATED_PAYLOAD, event_type: 'UnknownEvent' as never }]),
      } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: logger as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'UnknownEvent' as never }]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'decode_error' }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'aave_derivation_failed',
      expect.objectContaining({ reason: 'decode_error' }),
    );
  });

  it.each([
    ['ProposalExecuted', { proposalId: '42' }],
    ['ProposalCanceled', { proposalId: '42' }],
    ['ProposalFailed', { proposalId: '42', votesFor: '1', votesAgainst: '0' }],
  ] as const)(
    'derives %s state transitions through the parser switch',
    async (eventType, payload) => {
      const { pgDb } = makeProjectionTx({
        existingProposal: { id: 'proposal-1', source_id: '42' },
      });
      const metrics = makeMetrics();

      const applier = new AaveGovernanceProjectionApplier({
        pgDb: pgDb as never,
        registry: makeRegistry(),
        archive: { incrementAttemptCount: vi.fn() } as never,
        dlq: { markRetrySucceeded: vi.fn() } as never,
        payloads: {
          fetchPayloads: vi.fn().mockResolvedValue([
            {
              ...CREATED_PAYLOAD,
              event_type: eventType,
              payload: JSON.stringify(payload),
            },
          ]),
        } as never,
        ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
        metrics,
        logger: { warn: vi.fn(), error: vi.fn() } as never,
      });

      await applier.applyBatch([{ ...ROW, event_type: eventType }]);

      expect(metrics.processed).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'derived', reason: null, event_type: eventType }),
      );
    },
  );
});
