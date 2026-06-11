import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@libs/chain';
import type { ActorRepository, VoteEventsProjectionReadRepository } from '@libs/db';
import { AaveVotingPowerStrategy } from './aave-voting-power-strategy';

describe('AaveVotingPowerStrategy', () => {
  it('stores reported power for proposal voters and keeps the voting address', async () => {
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

    const strategy = new AaveVotingPowerStrategy(voteRead, actors);

    await expect(
      strategy.computeSnapshot(123n, { daoId: 'dao-1', proposalId: 'proposal-1' }),
    ).resolves.toEqual([
      { actorId: 'actor-1', address: '0xaaa', votingAddress: '0xabc', power: 12n },
      { actorId: 'actor-2', address: '0xbbb', votingAddress: '0xdef', power: 34n },
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
      logger,
    );

    await expect(
      strategy.computeSnapshot(1n, { daoId: 'dao-1', proposalId: 'p-1' }),
    ).resolves.toEqual([]);
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      'aave_snapshot_actor_primary_address_missing',
    );
  });

  it('does not consult token readers when computing reported power', async () => {
    const voteRead = {
      listVotersForProposal: vi
        .fn()
        .mockResolvedValue([{ voter_address: '0xabc', voting_power: '42' }]),
    } as unknown as VoteEventsProjectionReadRepository;
    const actors = {
      findActorIdsByAddresses: vi
        .fn()
        .mockResolvedValue([{ actor_id: 'actor-1', address: '0xabc' }]),
      findPrimaryAddressesByActorIds: vi
        .fn()
        .mockResolvedValue([{ actor_id: 'actor-1', address: '0xaaa' }]),
    } as unknown as ActorRepository;

    await expect(
      new AaveVotingPowerStrategy(voteRead, actors).computeSnapshot(123n, {
        daoId: 'dao-1',
        proposalId: 'proposal-1',
      }),
    ).resolves.toEqual([
      { actorId: 'actor-1', address: '0xaaa', votingAddress: '0xabc', power: 42n },
    ]);
  });
});
