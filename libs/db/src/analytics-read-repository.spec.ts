import { describe, expect, it, vi } from 'vitest';
import { AnalyticsReadRepository } from './analytics-read-repository';

function makeChain<T>(result: T) {
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    execute: vi.fn().mockResolvedValue(result),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.groupBy.mockReturnValue(chain);
  return chain;
}

describe('AnalyticsReadRepository — participationByBucket', () => {
  function makePgChain<T>(result: T) {
    const chain = {
      select: vi.fn(),
      where: vi.fn(),
      execute: vi.fn().mockResolvedValue(result),
    };
    chain.select.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    return chain;
  }

  function makeChChain<T>(result: T) {
    const chain = {
      select: vi.fn(),
      where: vi.fn(),
      groupBy: vi.fn(),
      execute: vi.fn().mockResolvedValue(result),
    };
    chain.select.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.groupBy.mockReturnValue(chain);
    return chain;
  }

  it('joins PG proposals with CH vote totals and computes participation rate', async () => {
    const pgRows = [
      {
        id: 'p1',
        source_type: 'compound_governor',
        eligible_voting_power: '1000000',
        bucket: new Date('2026-07-01'),
      },
      {
        id: 'p2',
        source_type: 'compound_governor',
        eligible_voting_power: '2000000',
        bucket: new Date('2026-07-01'),
      },
    ];
    const chRows = [
      { proposal_id: 'p1', cast_vp: '250000' },
      { proposal_id: 'p2', cast_vp: '500000' },
    ];
    const pgChainInst = makePgChain(pgRows);
    const chChainInst = makeChChain(chRows);
    const pg = { selectFrom: vi.fn().mockReturnValue(pgChainInst) };
    const ch = { selectFrom: vi.fn().mockReturnValue(chChainInst) };
    const repo = new AnalyticsReadRepository(ch as never, pg as never);

    const result = await repo.participationByBucket({
      daoId: 'dao-1',
      bucket: 'monthly',
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.source_type).toBe('compound_governor');
    expect(result[0]!.proposal_count).toBe(2);
    expect(result[0]!.proposals_with_data).toBe(2);
    // p1: 250000/1000000 = 0.25, p2: 500000/2000000 = 0.25 → avg = 0.25
    expect(result[0]!.participation_rate).toBe(0.25);
  });

  it('returns empty when no PG proposals have eligible VP', async () => {
    const pgChainInst = makePgChain([]);
    const pg = { selectFrom: vi.fn().mockReturnValue(pgChainInst) };
    const ch = { selectFrom: vi.fn() };
    const repo = new AnalyticsReadRepository(ch as never, pg as never);

    const result = await repo.participationByBucket({
      daoId: 'dao-1',
      bucket: 'monthly',
    });

    expect(result).toEqual([]);
    expect(ch.selectFrom).not.toHaveBeenCalled();
  });

  it('sets participation_rate to null when no proposals have cast votes', async () => {
    const pgRows = [
      {
        id: 'p1',
        source_type: 'test_type',
        eligible_voting_power: '1000000',
        bucket: new Date('2026-07-01'),
      },
    ];
    const pgChainInst = makePgChain(pgRows);
    const chChainInst = makeChChain([]);
    const pg = { selectFrom: vi.fn().mockReturnValue(pgChainInst) };
    const ch = { selectFrom: vi.fn().mockReturnValue(chChainInst) };
    const repo = new AnalyticsReadRepository(ch as never, pg as never);

    const result = await repo.participationByBucket({
      daoId: 'dao-1',
      bucket: 'monthly',
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.proposal_count).toBe(1);
    expect(result[0]!.proposals_with_data).toBe(0);
    expect(result[0]!.participation_rate).toBeNull();
  });

  it('groups by source_type and bucket, sorting by bucket', async () => {
    const pgRows = [
      {
        id: 'p1',
        source_type: 'aave_governor_v2',
        eligible_voting_power: '1000',
        bucket: new Date('2026-08-01'),
      },
      {
        id: 'p2',
        source_type: 'compound_governor',
        eligible_voting_power: '2000',
        bucket: new Date('2026-07-01'),
      },
    ];
    const chRows = [
      { proposal_id: 'p1', cast_vp: '500' },
      { proposal_id: 'p2', cast_vp: '400' },
    ];
    const pgChainInst = makePgChain(pgRows);
    const chChainInst = makeChChain(chRows);
    const pg = { selectFrom: vi.fn().mockReturnValue(pgChainInst) };
    const ch = { selectFrom: vi.fn().mockReturnValue(chChainInst) };
    const repo = new AnalyticsReadRepository(ch as never, pg as never);

    const result = await repo.participationByBucket({
      daoId: 'dao-1',
      bucket: 'monthly',
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.source_type).toBe('compound_governor');
    expect(result[0]!.bucket).toEqual(new Date('2026-07-01'));
    expect(result[1]!.source_type).toBe('aave_governor_v2');
    expect(result[1]!.bucket).toEqual(new Date('2026-08-01'));
  });
});

describe('AnalyticsReadRepository — guard tests for accidentally-safe aggregate reads', () => {
  it('guard R1: findEarliestDelegationEventAt returns the single min result unchanged', async () => {
    // Safe because min(created_at) over the VIEW rows = min over the support set.
    // A refactor changing min→count/sum/avg or switching to a raw row fetch would corrupt results.
    const expected = new Date('2024-01-01');
    const chChain = makeChain({ earliest: expected });
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new AnalyticsReadRepository(ch as never, { selectFrom: vi.fn() } as never);

    await expect(repo.findEarliestDelegationEventAt('dao-1')).resolves.toEqual(expected);
    expect(chChain.executeTakeFirst).toHaveBeenCalledOnce();
  });

  it('guard R1: findEarliestDelegationEventAt returns null when no rows exist', async () => {
    const chChain = makeChain(undefined);
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new AnalyticsReadRepository(ch as never, { selectFrom: vi.fn() } as never);

    await expect(repo.findEarliestDelegationEventAt('dao-1')).resolves.toBeNull();
  });

  it('guard R2: findGlobalEtlWatermark returns the single max result unchanged', async () => {
    // Safe because max(version) over VIEW rows = max over the support set.
    const expected = new Date('2025-06-01');
    const chChain = makeChain({ watermark: expected });
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new AnalyticsReadRepository(ch as never, { selectFrom: vi.fn() } as never);

    await expect(repo.findGlobalEtlWatermark()).resolves.toEqual(expected);
    expect(chChain.executeTakeFirst).toHaveBeenCalledOnce();
  });

  it('guard R5: currentVotingPowerByActor sums each actor addresses, folding in TypeScript', async () => {
    // This guard used to assert the OPPOSITE — that application code must NOT re-fold, because
    // argMax in ClickHouse had already collapsed rows per actor. That premise was the bug
    // (KNOWN-031): argMax over an actor-wide group returns whichever ONE address delegated most
    // recently, so an actor holding several addresses silently lost the rest of its power.
    //
    // ClickHouse now groups by address, so each argMax means "this address's standing delegation",
    // and the per-actor total is their sum — which only application code can compute, because only
    // Postgres knows which addresses share an actor (ADR-087).
    const addressRows = [
      { address: '0xaa', actor_id: 'a1' },
      { address: '0xbb', actor_id: 'a1' },
      { address: '0xcc', actor_id: 'a2' },
    ];
    const pgChain = makeChain(addressRows);
    const pg = { selectFrom: vi.fn().mockReturnValue(pgChain) };
    const chChain = makeChain([
      { delegator_address: '0xaa', voting_power: '100' },
      { delegator_address: '0xbb', voting_power: '50' },
      { delegator_address: '0xcc', voting_power: '7' },
    ]);
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new AnalyticsReadRepository(ch as never, pg as never);

    const result = await repo.currentVotingPowerByActor('dao-1', ['a1', 'a2']);

    expect(result).toEqual([
      { actor_id: 'a1', voting_power: '150' },
      { actor_id: 'a2', voting_power: '7' },
    ]);
    expect(chChain.execute).toHaveBeenCalledOnce();
  });

  it('guard R5: currentVotingPowerByActor keeps summed power exact past Number.MAX_SAFE_INTEGER', async () => {
    // The fold is BigInt, not Number: two addresses of ~9e18 each exceed 2^53 when summed.
    const pgChain = makeChain([
      { address: '0xaa', actor_id: 'a1' },
      { address: '0xbb', actor_id: 'a1' },
    ]);
    const chChain = makeChain([
      { delegator_address: '0xaa', voting_power: '9007199254740993' },
      { delegator_address: '0xbb', voting_power: '9007199254740993' },
    ]);
    const repo = new AnalyticsReadRepository(
      { selectFrom: vi.fn().mockReturnValue(chChain) } as never,
      { selectFrom: vi.fn().mockReturnValue(pgChain) } as never,
    );

    await expect(repo.currentVotingPowerByActor('dao-1', ['a1'])).resolves.toEqual([
      { actor_id: 'a1', voting_power: '18014398509481986' },
    ]);
  });
});
