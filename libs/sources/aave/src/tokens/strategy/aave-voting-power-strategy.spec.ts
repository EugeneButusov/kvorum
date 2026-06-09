import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@libs/chain';
import type { ActorRepository, VoteEventsProjectionReadRepository } from '@libs/db';
import { AaveVotingPowerStrategy } from './aave-voting-power-strategy';
import type { AaveGovernancePowerReader } from '../read/aave-governance-power-reader';

describe('AaveVotingPowerStrategy', () => {
  it('computes power for proposal voters and keeps the voting address', async () => {
    const voteRead = {
      listVotersForProposal: vi.fn().mockResolvedValue([
        { voterAddress: '0xabc', votingPower: '12' },
        { voterAddress: '0xdef', votingPower: '34' },
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
          .mockResolvedValue([{ voterAddress: '0xabc', votingPower: '7' }]),
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

  it('returns stored reported power from the vote projection', async () => {
    const voteRead = {
      findCurrentVote: vi.fn().mockResolvedValue({
        voteId: 'vote-1',
        castAt: new Date(),
        blockNumber: '100',
        logIndex: 0,
        primaryChoice: 1,
        votingPower: '42',
        votingChainId: '0x89',
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
