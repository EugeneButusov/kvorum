import { describe, expect, it, vi } from 'vitest';
import type { ChainContextRegistry } from '@libs/chain';
import type { ActorRepository, DaoSourceRepository } from '@libs/db';
import { CompoundCompTokenVotingPowerStrategy } from './compound-comp-token-voting-power-strategy';
import type { CompTokenDelegationSnapshotRepository } from '../persistence/delegation-snapshot-repository';

describe('CompoundCompTokenVotingPowerStrategy', () => {
  it('computeSnapshot builds population and applies latest votes_changed power', async () => {
    const delegations = {
      listForSnapshot: vi.fn().mockResolvedValue([
        {
          event_type: 'delegate_changed',
          delegator_address: '0xaaa',
          delegate_address: '0xbbb',
          voting_power: '0',
        },
        {
          event_type: 'votes_changed',
          delegator_address: '0xaaa',
          delegate_address: '0xbbb',
          voting_power: '10',
        },
      ]),
    } as unknown as CompTokenDelegationSnapshotRepository;
    const actors = {
      findActorsByAddresses: vi.fn().mockResolvedValue([{ id: 'actor-1' }, { id: 'actor-2' }]),
      findPrimaryAddressesByActorIds: vi.fn().mockResolvedValue([
        { actor_id: 'actor-1', address: '0xaaa' },
        { actor_id: 'actor-2', address: '0xbbb' },
      ]),
    } as unknown as ActorRepository;
    const daoSources = {} as DaoSourceRepository;
    const registry = { peek: vi.fn() } as unknown as ChainContextRegistry;

    const strategy = new CompoundCompTokenVotingPowerStrategy(
      delegations,
      actors,
      daoSources,
      registry,
      '0x1',
    );

    const rows = await strategy.computeSnapshot(123n, { daoId: 'dao-1' });
    const byActor = new Map(rows.map((row) => [row.actorId, row]));

    expect(delegations.listForSnapshot).toHaveBeenCalledWith('dao-1', '123');
    expect(byActor.get('actor-1')).toMatchObject({ address: '0xaaa', power: 0n });
    expect(byActor.get('actor-2')).toMatchObject({ address: '0xbbb', power: 10n });
  });

  it('verifyOnChain resolves token address and calls eth_call', async () => {
    const send = vi
      .fn()
      .mockResolvedValue('0x000000000000000000000000000000000000000000000000000000000000002a');
    const registry = {
      peek: vi.fn().mockReturnValue({ client: { send } }),
    } as unknown as ChainContextRegistry;
    const daoSources = {
      findTokenAddressByDaoAndSourceType: vi
        .fn()
        .mockResolvedValue('0x1234567890abcdef1234567890abcdef12345678'),
    } as unknown as DaoSourceRepository;

    const strategy = new CompoundCompTokenVotingPowerStrategy(
      { listForSnapshot: vi.fn() } as unknown as CompTokenDelegationSnapshotRepository,
      { findPrimaryAddressesByActorIds: vi.fn() } as unknown as ActorRepository,
      daoSources,
      registry,
      '0x1',
    );

    await expect(
      strategy.verifyOnChain('0x00000000000000000000000000000000000000ab', 99n, { daoId: 'dao-1' }),
    ).resolves.toBe(42n);
    expect(daoSources.findTokenAddressByDaoAndSourceType).toHaveBeenCalledWith(
      'dao-1',
      'compound_comp_token',
    );
    expect(send).toHaveBeenCalledWith(
      'eth_call',
      expect.arrayContaining([
        { to: '0x1234567890abcdef1234567890abcdef12345678', data: expect.any(String) },
        '0x63',
      ]),
    );
  });

  it('throws when token address is missing', async () => {
    const strategy = new CompoundCompTokenVotingPowerStrategy(
      { listForSnapshot: vi.fn() } as unknown as CompTokenDelegationSnapshotRepository,
      { findPrimaryAddressesByActorIds: vi.fn() } as unknown as ActorRepository,
      {
        findTokenAddressByDaoAndSourceType: vi.fn().mockResolvedValue(undefined),
      } as unknown as DaoSourceRepository,
      {
        peek: vi.fn().mockReturnValue({ client: { send: vi.fn() } }),
      } as unknown as ChainContextRegistry,
      '0x1',
    );

    await expect(
      strategy.verifyOnChain('0x00000000000000000000000000000000000000ab', 1n, { daoId: 'dao-1' }),
    ).rejects.toThrow('compound_comp_token token address missing for dao_id=dao-1');
  });
});
