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
    updatedSnapshotHash: undefined as unknown,
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
          if (table === 'aave_proposal_metadata') calls.updatedSnapshotHash = values;
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

  it('sets snapshot hash and advances active state on VotingActivated', async () => {
    const { pgDb, calls } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '42' },
    });
    const metrics = makeMetrics();

    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
      archive: { incrementAttemptCount: vi.fn() } as never,
      dlq: { markRetrySucceeded: vi.fn() } as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([ACTIVATED_PAYLOAD]) } as never,
      ipfsFetcher: { fetchTitleDescription: vi.fn() } as never,
      metrics,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    });

    await applier.applyBatch([{ ...ROW, event_type: 'VotingActivated' }]);

    expect(calls.updatedSnapshotHash).toEqual({ snapshot_block_hash: '0x' + '34'.repeat(32) });
    expect(calls.markedDerivedId).toBe('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('inserts declared payload rows when the proposal exists', async () => {
    const { pgDb, calls } = makeProjectionTx({
      existingProposal: { id: 'proposal-1', source_id: '42' },
    });
    const applier = new AaveGovernanceProjectionApplier({
      pgDb: pgDb as never,
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
      }),
    );
  });

  it('increments attempt count when a non-create event arrives before proposal creation', async () => {
    const archive = { incrementAttemptCount: vi.fn().mockResolvedValue(undefined) };
    const applier = new AaveGovernanceProjectionApplier({
      pgDb: makeProjectionTx({ existingProposal: undefined }).pgDb as never,
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
});
