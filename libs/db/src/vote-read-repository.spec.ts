import { describe, expect, it, vi } from 'vitest';
import { VoteReadRepository } from './vote-read-repository';

function makeSelectChain(returnValue: unknown) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    execute,
    executeTakeFirst,
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('VoteReadRepository', () => {
  it('listBaseQuery includes superseded filter', async () => {
    const { selectFrom, chain } = makeSelectChain([]);
    const repo = new VoteReadRepository({ selectFrom } as never);

    await repo.listBaseQuery().execute();

    expect(selectFrom).toHaveBeenCalledWith('vote');
    expect(chain.where).toHaveBeenCalledWith('vote.superseded_by_vote_id', 'is', null);
  });

  it('findOneByVoter filters by proposal and voter actor ids', async () => {
    const row = { id: 'v1' };
    const { selectFrom, chain } = makeSelectChain(row);
    const repo = new VoteReadRepository({ selectFrom } as never);

    await repo.findOneByVoter('p1', 'a1');

    expect(chain.where).toHaveBeenCalledWith('vote.proposal_id', '=', 'p1');
    expect(chain.where).toHaveBeenCalledWith('vote.voter_actor_id', '=', 'a1');
  });

  it('findChoicesForVote orders by choice_index', async () => {
    const rows = [{ choice_index: 0, weight: '1.0' }];
    const { selectFrom, chain } = makeSelectChain(rows);
    const repo = new VoteReadRepository({ selectFrom } as never);

    await expect(repo.findChoicesForVote('vote-1')).resolves.toEqual(rows);
    expect(selectFrom).toHaveBeenCalledWith('vote_choice');
    expect(chain.where).toHaveBeenCalledWith('vote_id', '=', 'vote-1');
    expect(chain.orderBy).toHaveBeenCalledWith('choice_index', 'asc');
  });
});
