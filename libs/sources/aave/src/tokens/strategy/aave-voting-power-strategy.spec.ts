import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@libs/chain';
import type { ActorRepository, VoteEventsProjectionReadRepository } from '@libs/db';
import { AaveVotingPowerStrategy } from './aave-voting-power-strategy';
import type { AaveGovernancePowerReader } from '../read/aave-governance-power-reader';

describe('AaveVotingPowerStrategy', () => {
  it('computes power for proposal voters and keeps the voting address', async () => {
    const voteRead = {
      listVotersForProposal: vi.fn().mockResolvedValue([
        { voter_address: '0xabc', voting_power: '12' },
        { voter_address: '0xdef', voting_power: '34' },
      ]),
    } as unknown as VoteEventsProjectionReadRepository;
    const actors = {
      findActorIdsByAddresses: vi.fn().mockResolvedValue([
        { actor_id: 'actor-1', address: '0xabc' },
        { actor_id: 'actor-2', address: '0xdef' },
      ]),
      findPrimaryAddressesByActorIds: vi.fn().mockResolvedValue([
        { actor_id: 'actor-1', address: '0xaaa' },
        { actor_id: 'actor-2', address: '0xbbb' },
      ]),
    } as unknown as ActorRepository;
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ aave: 10n, stkAave: 20n, aAave: 30n })
        .mockResolvedValueOnce({ aave: 1n, stkAave: 2n, aAave: 3n }),
    } as unknown as AaveGovernancePowerReader;

    const strategy = new AaveVotingPowerStrategy(voteRead, actors, reader);

    await expect(
      strategy.computeSnapshot(123n, { daoId: 'dao-1', proposalId: 'proposal-1' }),
    ).resolves.toEqual([
      { actorId: 'actor-1', address: '0xaaa', votingAddress: '0xabc', power: 60n },
      { actorId: 'actor-2', address: '0xbbb', votingAddress: '0xdef', power: 6n },
    ]);
  });

  it('skips voters whose actor mapping is missing', async () => {
    const logger = { warn: vi.fn() } as unknown as Logger;
    const strategy = new AaveVotingPowerStrategy(
      {
        listVotersForProposal: vi
          .fn()
          .mockResolvedValue([{ voter_address: '0xabc', voting_power: '7' }]),
      } as unknown as VoteEventsProjectionReadRepository,
      {
        findActorIdsByAddresses: vi.fn().mockResolvedValue([]),
        findPrimaryAddressesByActorIds: vi.fn().mockResolvedValue([]),
      } as unknown as ActorRepository,
      { read: vi.fn() } as unknown as AaveGovernancePowerReader,
      logger,
    );

    await expect(
      strategy.computeSnapshot(123n, { daoId: 'dao-1', proposalId: 'proposal-1' }),
    ).resolves.toEqual([]);
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      'aave_snapshot_actor_missing_for_voter',
    );
  });

  it('throws when proposalId is absent in computeSnapshot', async () => {
    const strategy = new AaveVotingPowerStrategy(
      {} as VoteEventsProjectionReadRepository,
      {} as ActorRepository,
      {} as AaveGovernancePowerReader,
    );

    await expect(strategy.computeSnapshot(1n, { daoId: 'dao-1', proposalId: '' })).rejects.toThrow(
      'proposalId is required',
    );

    await expect(strategy.computeSnapshot(1n, { daoId: 'dao-1' })).rejects.toThrow(
      'proposalId is required',
    );
  });

  it('skips voters whose primary address resolution is missing', async () => {
    const logger = { warn: vi.fn() } as unknown as Logger;
    const strategy = new AaveVotingPowerStrategy(
      {
        listVotersForProposal: vi
          .fn()
          .mockResolvedValue([{ voter_address: '0xabc', voting_power: '7' }]),
      } as unknown as VoteEventsProjectionReadRepository,
      {
        findActorIdsByAddresses: vi
          .fn()
          .mockResolvedValue([{ actor_id: 'actor-1', address: '0xabc' }]),
        findPrimaryAddressesByActorIds: vi.fn().mockResolvedValue([]), // no primary
      } as unknown as ActorRepository,
      { read: vi.fn() } as unknown as AaveGovernancePowerReader,
      logger,
    );

    await expect(
      strategy.computeSnapshot(1n, { daoId: 'dao-1', proposalId: 'p-1' }),
    ).resolves.toEqual([]);
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      'aave_snapshot_actor_primary_address_missing',
    );
  });

  it('throws when proposalId is absent in verifyOnChain', async () => {
    const strategy = new AaveVotingPowerStrategy(
      {} as VoteEventsProjectionReadRepository,
      {} as ActorRepository,
      {} as AaveGovernancePowerReader,
    );

    await expect(
      strategy.verifyOnChain('0xabc', 1n, { daoId: 'dao-1', proposalId: '' }),
    ).rejects.toThrow('proposalId is required');

    await expect(strategy.verifyOnChain('0xabc', 1n, { daoId: 'dao-1' })).rejects.toThrow(
      'proposalId is required',
    );
  });

  it('throws when no matching vote is found in verifyOnChain', async () => {
    const strategy = new AaveVotingPowerStrategy(
      {
        findCurrentVote: vi.fn().mockResolvedValue(undefined),
      } as unknown as VoteEventsProjectionReadRepository,
      {} as ActorRepository,
      {} as AaveGovernancePowerReader,
    );

    await expect(
      strategy.verifyOnChain('0xabc', 1n, { daoId: 'dao-1', proposalId: 'p-1' }),
    ).rejects.toThrow('vote not found');
  });

  it('returns stored reported power from the vote projection', async () => {
    const voteRead = {
      findCurrentVote: vi.fn().mockResolvedValue({
        vote_id: 'vote-1',
        cast_at: new Date(),
        block_number: '100',
        log_index: 0,
        primary_choice: 1,
        voting_power: '42',
        voting_chain_id: '0x89',
      }),
    } as unknown as VoteEventsProjectionReadRepository;
    const strategy = new AaveVotingPowerStrategy(
      voteRead,
      {} as ActorRepository,
      {} as AaveGovernancePowerReader,
    );

    await expect(
      strategy.verifyOnChain('0xAbC', 123n, { daoId: 'dao-1', proposalId: 'proposal-1' }),
    ).resolves.toBe(42n);
    expect(voteRead.findCurrentVote).toHaveBeenCalledWith({
      daoId: 'dao-1',
      proposalId: 'proposal-1',
      voterAddress: '0xabc',
    });
  });
});
