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
      source_type: 'compound_governor_bravo',
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
      state_updated_at: new Date('2026-01-01T00:00:00Z'),
      created_at: new Date('2026-01-01T00:00:00Z'),
      proposer_address: '0xabc',
      proposer_display_name: 'Alice',
    };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new ProposalReadRepository({ selectFrom } as never);

    await expect(repo.findOne('alpha', 'compound_governor_bravo', '42')).resolves.toEqual(row);
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

  describe('findChoicesForProposals', () => {
    it('short-circuits on an empty page without touching the database', async () => {
      const { selectFrom } = makeSelectChain([]);
      const repo = new ProposalReadRepository({ selectFrom } as never);

      await expect(repo.findChoicesForProposals([])).resolves.toEqual(new Map());
      expect(selectFrom).not.toHaveBeenCalled();
    });

    it('reads the whole page in one query, keyed by proposal', async () => {
      const rows = [
        { proposal_id: 'p1', choice_index: 0, value: 'against' },
        { proposal_id: 'p1', choice_index: 1, value: 'for' },
        { proposal_id: 'p2', choice_index: 0, value: 'against' },
      ];
      const { selectFrom, chain } = makeSelectChain(rows);
      const repo = new ProposalReadRepository({ selectFrom } as never);

      const out = await repo.findChoicesForProposals(['p1', 'p2']);

      // One round-trip for the page — the reason this method exists.
      expect(selectFrom).toHaveBeenCalledTimes(1);
      expect(selectFrom).toHaveBeenCalledWith('proposal_choice');
      expect(chain.where).toHaveBeenCalledWith('proposal_id', 'in', ['p1', 'p2']);
      expect(chain.orderBy).toHaveBeenCalledWith('choice_index', 'asc');
      expect(out.get('p1')).toEqual([rows[0], rows[1]]);
      expect(out.get('p2')).toEqual([rows[2]]);
    });

    it('omits a proposal that declares no choices rather than mapping it to []', async () => {
      // The caller distinguishes absent (fall back to a positional label) from an empty list.
      const { selectFrom } = makeSelectChain([
        { proposal_id: 'p1', choice_index: 0, value: 'for' },
      ]);
      const repo = new ProposalReadRepository({ selectFrom } as never);

      const out = await repo.findChoicesForProposals(['p1', 'p2']);

      expect(out.has('p2')).toBe(false);
    });

    it('accepts a readonly id list without mutating the caller’s array', async () => {
      const ids: readonly string[] = Object.freeze(['p1']);
      const { selectFrom, chain } = makeSelectChain([]);
      const repo = new ProposalReadRepository({ selectFrom } as never);

      await expect(repo.findChoicesForProposals(ids)).resolves.toEqual(new Map());
      // Copied into a fresh array for the `in` clause — Kysely mutating a frozen array would throw.
      expect(chain.where).toHaveBeenCalledWith('proposal_id', 'in', ['p1']);
      expect(chain.where.mock.calls[0]?.[2]).not.toBe(ids);
    });
  });

  it('findOneWithDao returns combined dao and proposal objects', async () => {
    const row = {
      dao_id: 'dao-1',
      dao_slug: 'compound',
      dao_name: 'Compound',
      dao_primary_token_address: '0xabc',
      dao_primary_chain_id: '1',
      dao_description: 'desc',
      dao_website_url: 'https://example.com',
      dao_forum_url: 'https://forum.example.com',
      dao_created_at: new Date('2026-01-01T00:00:00Z'),
      dao_updated_at: new Date('2026-01-01T00:00:00Z'),
      proposal_id: 'proposal-1',
      proposal_dao_id: 'dao-1',
      proposal_source_type: 'compound_governor_bravo',
      proposal_source_id: '42',
      proposal_proposer_actor_id: 'actor-1',
      proposal_title: 'Title',
      proposal_description: 'Description',
      proposal_description_hash: 'a'.repeat(64),
      proposal_binding: true,
      proposal_voting_starts_at: null,
      proposal_voting_ends_at: null,
      proposal_voting_starts_block: '10',
      proposal_voting_ends_block: '20',
      proposal_state: 'active',
      proposal_state_updated_at: new Date('2026-01-01T00:00:00Z'),
      proposal_created_at: new Date('2026-01-01T00:00:00Z'),
      proposal_updated_at: new Date('2026-01-01T00:00:00Z'),
    };
    const { selectFrom } = makeSelectChain(row);
    const repo = new ProposalReadRepository({ selectFrom } as never);

    const out = await repo.findOneWithDao('compound', 'compound_governor_bravo', '42');
    expect(out?.dao.slug).toBe('compound');
    expect(out?.proposal.source_id).toBe('42');
  });
});
