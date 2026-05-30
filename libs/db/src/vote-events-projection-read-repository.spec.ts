import { describe, expect, it, vi } from 'vitest';
import { VoteEventsProjectionReadRepository } from './vote-events-projection-read-repository';

function makeChain<T>(result: T) {
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

describe('VoteEventsProjectionReadRepository', () => {
  it('returns current vote row for dao/proposal/voter tuple', async () => {
    const row = {
      voteId: 'vote-1',
      castAt: new Date('2026-01-01T00:00:00.000Z'),
      blockNumber: '100',
      logIndex: 2,
      primaryChoice: 1,
      votingPower: '42',
    };
    const chChain = makeChain(row);
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new VoteEventsProjectionReadRepository(ch as never);

    await expect(
      repo.findCurrentVote({ daoId: 'dao-1', proposalId: 'p-1', voterAddress: '0xabc' }),
    ).resolves.toEqual(row);
    expect(chChain.where).toHaveBeenCalledWith('vef.dao_id', '=', 'dao-1');
    expect(chChain.where).toHaveBeenCalledWith('vef.proposal_id', '=', 'p-1');
    expect(chChain.where).toHaveBeenCalledWith('vef.voter_address', '=', '0xabc');
    expect(chChain.where).toHaveBeenCalledWith('vef.superseded', '=', 0);
  });

  it('returns undefined when there is no current vote', async () => {
    const chChain = makeChain(undefined);
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new VoteEventsProjectionReadRepository(ch as never);

    await expect(
      repo.findCurrentVote({ daoId: 'dao-1', proposalId: 'p-1', voterAddress: '0xabc' }),
    ).resolves.toBeUndefined();
  });

  it('applies deterministic ORDER BY as a defensive guard (§4.2b fix)', async () => {
    // The VIEW over AggregatingMergeTree provides one row per sorting key, so ORDER BY
    // + LIMIT 1 is a defensive fallback. A refactor removing these or changing a direction
    // would re-open the window where a stale row could be picked if the guard ever relaxes.
    const row = {
      voteId: 'v1',
      castAt: new Date(),
      blockNumber: '100',
      logIndex: 0,
      primaryChoice: 1,
      votingPower: '100',
    };
    const chChain = makeChain(row);
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new VoteEventsProjectionReadRepository(ch as never);

    await repo.findCurrentVote({ daoId: 'dao-1', proposalId: 'prop-1', voterAddress: '0xabc' });

    expect(chChain.orderBy.mock.calls).toEqual([
      ['vef.cast_at', 'desc'],
      ['vef.block_number', 'desc'],
      ['vef.log_index', 'desc'],
    ]);
    expect(chChain.limit).toHaveBeenCalledWith(1);
  });
});
