import { describe, expect, it, vi } from 'vitest';
import type { ActorRepository } from '@libs/db';
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

    const strategy = new CompoundCompTokenVotingPowerStrategy(delegations, actors);

    const rows = await strategy.computeSnapshot(123n, { daoId: 'dao-1' });
    const byActor = new Map(rows.map((row) => [row.actorId, row]));

    expect(delegations.listForSnapshot).toHaveBeenCalledWith('dao-1', '123');
    expect(byActor.get('actor-1')).toMatchObject({ address: '0xaaa', power: 0n });
    expect(byActor.get('actor-2')).toMatchObject({ address: '0xbbb', power: 10n });
  });
});
