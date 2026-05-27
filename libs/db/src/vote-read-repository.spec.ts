import { describe, expect, it, vi } from 'vitest';
import { VoteReadRepository } from './vote-read-repository';

function makeChain<T>(result: T) {
  const chain = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    execute: vi.fn().mockResolvedValue(result),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

describe('VoteReadRepository', () => {
  it('listForProposal returns empty when proposal is missing', async () => {
    const pgProposalChain = makeChain(undefined);
    const pg = {
      selectFrom: vi.fn().mockImplementation((table: string) => {
        if (table === 'proposal as p') return pgProposalChain;
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const ch = { selectFrom: vi.fn() };
    const repo = new VoteReadRepository(pg as never, ch as never);

    await expect(repo.listForProposal({ proposalId: 'p1' })).resolves.toEqual([]);
    expect(ch.selectFrom).not.toHaveBeenCalled();
  });

  it('findChoicesForVote returns single weighted choice from primary_choice', async () => {
    const chChain = makeChain({ primary_choice: 2 });
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new VoteReadRepository({ selectFrom: vi.fn() } as never, ch as never);

    await expect(repo.findChoicesForVote('vote-1')).resolves.toEqual([
      { choice_index: 2, weight: '1.0' },
    ]);
    expect(chChain.where).toHaveBeenCalledWith('v.vote_id', '=', 'vote-1');
  });

  it('findChoicesForVote returns empty when vote is missing', async () => {
    const chChain = makeChain(undefined);
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new VoteReadRepository({ selectFrom: vi.fn() } as never, ch as never);

    await expect(repo.findChoicesForVote('vote-1')).resolves.toEqual([]);
  });
});
