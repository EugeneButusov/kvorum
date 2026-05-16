import { describe, expect, it, vi } from 'vitest';
import { ProposalReadRepository } from './proposal-read-repository';

function makeSelectChain(returnValue: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    innerJoin: vi.fn(),
    selectAll: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    execute,
    executeTakeFirst,
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.selectAll.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('ProposalReadRepository', () => {
  it('findOne selects proposal fields including derived hashes and block numbers', async () => {
    const row = {
      id: 'proposal-1',
      dao_slug: 'alpha',
      source_type: 'compound_governor',
      source_id: '42',
      title: 'Title',
      description: 'Description',
      description_hash: 'a'.repeat(64),
      state: 'pending',
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: '10',
      voting_ends_block: '20',
      voting_power_block: '10',
      state_updated_at: new Date('2026-01-01T00:00:00Z'),
      created_at: new Date('2026-01-01T00:00:00Z'),
      proposer_address: '0xabc',
      proposer_display_name: 'Alice',
    };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new ProposalReadRepository({ selectFrom } as never);

    await expect(repo.findOne('alpha', 'compound_governor', '42')).resolves.toEqual(row);
    expect(selectFrom).toHaveBeenCalledWith('proposal');
    expect(chain.innerJoin).toHaveBeenCalledWith('dao', 'dao.id', 'proposal.dao_id');
    expect(chain.innerJoin).toHaveBeenCalledWith('actor', 'actor.id', 'proposal.proposer_actor_id');
    expect(chain.select).toHaveBeenCalledWith([
      'proposal.id',
      'dao.slug as dao_slug',
      'proposal.source_type',
      'proposal.source_id',
      'proposal.title',
      'proposal.description',
      'proposal.description_hash',
      'proposal.state',
      'proposal.binding',
      'proposal.voting_starts_at',
      'proposal.voting_ends_at',
      'proposal.voting_starts_block',
      'proposal.voting_ends_block',
      'proposal.voting_power_block',
      'proposal.state_updated_at',
      'proposal.created_at',
      'actor.primary_address as proposer_address',
      'actor.display_name as proposer_display_name',
    ]);
  });

  it('findActions reads proposal actions in ascending order', async () => {
    const rows = [{ proposal_id: 'proposal-1', action_index: 0 }];
    const { selectFrom, chain } = makeSelectChain(rows);
    const repo = new ProposalReadRepository({ selectFrom } as never);

    await expect(repo.findActions('proposal-1')).resolves.toEqual(rows);
    expect(selectFrom).toHaveBeenCalledWith('proposal_action');
    expect(chain.selectAll).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalledWith('proposal_id', '=', 'proposal-1');
    expect(chain.orderBy).toHaveBeenCalledWith('action_index', 'asc');
  });

  it('findChoices reads proposal choices in ascending order', async () => {
    const rows = [{ proposal_id: 'proposal-1', choice_index: 0 }];
    const { selectFrom, chain } = makeSelectChain(rows);
    const repo = new ProposalReadRepository({ selectFrom } as never);

    await expect(repo.findChoices('proposal-1')).resolves.toEqual(rows);
    expect(selectFrom).toHaveBeenCalledWith('proposal_choice');
    expect(chain.selectAll).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalledWith('proposal_id', '=', 'proposal-1');
    expect(chain.orderBy).toHaveBeenCalledWith('choice_index', 'asc');
  });
});
