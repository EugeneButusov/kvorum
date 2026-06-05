import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import {
  AaveVoteProjectionApplier,
  type AaveVoteProjectionApplierDeps,
} from './vote-projection-applier';
import type { AaveVotingMachineArchivePayloadRow } from '../persistence/archive-payload-repository';

const BASE_ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_voting_machine',
  dao_source_id: 'source-1',
  chain_id: '0x89',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'VoteEmitted',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const BASE_PAYLOAD: AaveVotingMachineArchivePayloadRow = {
  chain_id: '0x89',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'VoteEmitted',
  payload: JSON.stringify({
    proposalId: '42',
    voter: '0x' + 'ab'.repeat(20),
    support: true,
    votingPower: '123',
  }),
  received_at: new Date('2026-01-01T00:00:00Z'),
};

interface MutableApplier {
  blockTimestamps: {
    fetchBatch: ReturnType<typeof vi.fn>;
    resultKey: (blockNumber: string, blockHash: string) => string;
  };
  registry: { peek: ReturnType<typeof vi.fn> };
}

function mutable(applier: AaveVoteProjectionApplier): MutableApplier {
  return applier as unknown as MutableApplier;
}

function buildApplier(options?: {
  payloads?: readonly AaveVotingMachineArchivePayloadRow[];
  chainCtx?: unknown;
}) {
  const archive: AaveVoteProjectionApplierDeps['archive'] = {
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    markDerived: vi.fn().mockResolvedValue(undefined),
  } as never;
  const dlq: AaveVoteProjectionApplierDeps['dlq'] = {
    insert: vi.fn().mockResolvedValue(undefined),
  } as never;
  const payloads: AaveVoteProjectionApplierDeps['payloads'] = {
    fetchPayloads: vi.fn().mockResolvedValue(options?.payloads ?? [BASE_PAYLOAD]),
  } as never;
  const proposals: AaveVoteProjectionApplierDeps['proposals'] = {
    findDaoIdForSource: vi.fn(),
    findBySource: vi.fn(),
  } as never;
  const aaveProposals: AaveVoteProjectionApplierDeps['aaveProposals'] = {
    setVotingChainBinding: vi.fn().mockResolvedValue(undefined),
    findVotingMachineAddress: vi.fn().mockResolvedValue('0x' + '11'.repeat(20)),
  } as never;
  const voteRead: AaveVoteProjectionApplierDeps['voteRead'] = {
    findCurrentVote: vi.fn(),
  } as never;
  const voteWrite: AaveVoteProjectionApplierDeps['voteWrite'] = {
    insertBatch: vi.fn().mockResolvedValue(undefined),
  } as never;
  const metrics = { batchLookupSeconds: vi.fn(), chWriteSeconds: vi.fn(), processed: vi.fn() };
  const logger = { error: vi.fn() };
  const registry: AaveVoteProjectionApplierDeps['registry'] = {
    peek: vi
      .fn()
      .mockReturnValue(options?.chainCtx ?? { client: {}, chainCfg: { chainId: '0x89' } }),
  } as never;
  const applier = new AaveVoteProjectionApplier({
    archive,
    dlq,
    payloads,
    proposals,
    aaveProposals,
    voteRead,
    voteWrite,
    metrics,
    registry,
    logger: logger as never,
  });
  mutable(applier).blockTimestamps = {
    fetchBatch: vi
      .fn()
      .mockResolvedValue(new Map([['100:0xblock', new Date('2026-01-01T00:01:40Z')]])),
    resultKey: (blockNumber: string, blockHash: string) => `${blockNumber}:${blockHash}`,
  };

  return {
    applier,
    archive,
    dlq,
    payloads,
    proposals,
    aaveProposals,
    voteRead,
    voteWrite,
    metrics,
    logger,
  };
}

describe('AaveVoteProjectionApplier', () => {
  it('projects VoteEmitted into vote_events rows and marks derived', async () => {
    const { applier, archive, proposals, voteRead, voteWrite, aaveProposals } = buildApplier();
    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-uuid' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(voteWrite.insertBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        vote_id: 'archive-1',
        voting_chain_id: '0x89',
        primary_choice: 1,
        voting_power: '123',
        cast_at: new Date('2026-01-01T00:01:40Z'),
      }),
    ]);
    expect(aaveProposals.setVotingChainBinding).toHaveBeenCalledWith('proposal-uuid', {
      votingChainId: '0x89',
      votingMachineAddress: '0x' + '11'.repeat(20),
    });
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
  });

  it('looks proposals up under aave_governance_v3 rather than row.source_type', async () => {
    const { applier, proposals } = buildApplier();
    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(proposals.findBySource).toHaveBeenCalledWith({
      daoId: 'dao-1',
      sourceType: 'aave_governance_v3',
      sourceId: '42',
    });
  });

  it('holds VoteEmitted indefinitely when proposal is missing', async () => {
    const { applier, archive, dlq, proposals, voteWrite } = buildApplier();
    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([BASE_ROW]);

    expect(voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(archive.markDerived).not.toHaveBeenCalled();
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
    expect(dlq.insert).not.toHaveBeenCalled();
  });

  it('skips re-deriving the already current row', async () => {
    const { applier, archive, proposals, voteRead, voteWrite } = buildApplier();
    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-uuid' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue({
      voteId: 'archive-1',
      castAt: new Date('2026-01-01T00:01:40Z'),
      blockNumber: '100',
      logIndex: 1,
      primaryChoice: 1,
      votingPower: '123',
      votingChainId: '0x89',
    });

    await applier.applyBatch([BASE_ROW]);

    expect(voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
  });

  it('holds and alerts on single-voting-chain invariant violations', async () => {
    const { applier, archive, dlq, proposals, voteRead, voteWrite, metrics, logger } =
      buildApplier();
    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-uuid' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue({
      voteId: 'existing-vote',
      castAt: new Date('2026-01-01T00:01:39Z'),
      blockNumber: '99',
      logIndex: 0,
      primaryChoice: 0,
      votingPower: '100',
      votingChainId: '0xa86a',
    });

    await applier.applyBatch([BASE_ROW]);

    expect(voteWrite.insertBatch).not.toHaveBeenCalled();
    expect(archive.markDerived).not.toHaveBeenCalled();
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
    expect(dlq.insert).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason: 'single_voting_chain_violation',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'aave_vote_single_voting_chain_violation',
      expect.any(Object),
    );
  });

  it('binds voting chain on VoteEmitted only for the first vote', async () => {
    const { applier, proposals, voteRead, aaveProposals } = buildApplier();
    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-uuid' });
    (voteRead.findCurrentVote as ReturnType<typeof vi.fn>).mockResolvedValue({
      voteId: 'existing-vote',
      castAt: new Date('2026-01-01T00:01:39Z'),
      blockNumber: '99',
      logIndex: 0,
      primaryChoice: 0,
      votingPower: '100',
      votingChainId: '0x89',
    });

    await applier.applyBatch([BASE_ROW]);

    expect(aaveProposals.setVotingChainBinding).not.toHaveBeenCalled();
  });

  it('binds voting chain for ProposalVoteStarted using the proposal UUID', async () => {
    const row = { ...BASE_ROW, event_type: 'ProposalVoteStarted' as const };
    const payload = {
      ...BASE_PAYLOAD,
      event_type: 'ProposalVoteStarted' as const,
      payload: JSON.stringify({
        proposalId: '42',
        l1BlockHash: '0x' + '22'.repeat(32),
        startTime: '1',
        endTime: '2',
      }),
    };
    const { applier, archive, proposals, aaveProposals } = buildApplier({ payloads: [payload] });
    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'proposal-uuid' });

    await applier.applyBatch([row]);

    expect(aaveProposals.setVotingChainBinding).toHaveBeenCalledWith('proposal-uuid', {
      votingChainId: '0x89',
      votingMachineAddress: '0x' + '11'.repeat(20),
    });
    expect(archive.markDerived).toHaveBeenCalledWith('archive-1');
  });

  it('holds ProposalVoteStarted indefinitely when proposal is missing', async () => {
    const row = { ...BASE_ROW, event_type: 'ProposalVoteStarted' as const };
    const payload = {
      ...BASE_PAYLOAD,
      event_type: 'ProposalVoteStarted' as const,
      payload: JSON.stringify({
        proposalId: '42',
        l1BlockHash: '0x' + '22'.repeat(32),
        startTime: '1',
        endTime: '2',
      }),
    };
    const { applier, archive, dlq, proposals, aaveProposals } = buildApplier({
      payloads: [payload],
    });
    (proposals.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue('dao-1');
    (proposals.findBySource as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await applier.applyBatch([row]);

    expect(aaveProposals.setVotingChainBinding).not.toHaveBeenCalled();
    expect(archive.markDerived).not.toHaveBeenCalled();
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
    expect(dlq.insert).not.toHaveBeenCalled();
  });
});
