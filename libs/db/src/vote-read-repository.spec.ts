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

  it('findChoicesForVote synthesizes a single-element breakdown from primary_choice', async () => {
    const chChain = makeChain({ primary_choice: 2 });
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new VoteReadRepository({ selectFrom: vi.fn() } as never, ch as never);

    await expect(repo.findChoicesForVote('vote-1')).resolves.toEqual([
      { choice_index: 2, weight: '1.0' },
    ]);
    expect(chChain.where).toHaveBeenCalledWith('v.vote_id', '=', 'vote-1');
  });

  it('findChoicesForVote returns empty when the vote is missing', async () => {
    const chChain = makeChain(undefined);
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new VoteReadRepository({ selectFrom: vi.fn() } as never, ch as never);

    await expect(repo.findChoicesForVote('vote-1')).resolves.toEqual([]);
  });

  it('findChoicesForVote uses executeTakeFirst — the projection VIEW exposes one row per vote_id', async () => {
    // Safe: the vote_events_projection VIEW groups by the full sorting key including vote_id,
    // so each vote_id is exactly one row. executeTakeFirst() picks it; execute() would return
    // an array and break the caller. A refactor switching to execute() would be unsafe.
    const chChain = makeChain({ primary_choice: 1 });
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new VoteReadRepository({ selectFrom: vi.fn() } as never, ch as never);

    const result = await repo.findChoicesForVote('vote-1');

    expect(result).toHaveLength(1);
    expect(chChain.executeTakeFirst).toHaveBeenCalledOnce();
  });
});
