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

  it('guard R5: currentVotingPowerByActor passes through grouped rows unchanged (argMax dedup is in CH)', async () => {
    // Safe because argMax(voting_power, created_at) in the SQL collapses rows per actor
    // to the one with the latest created_at. Application code does NOT re-fold the result —
    // a refactor adding a second fold or switching aggregate would be unsafe.
    const expected = [
      { actor_id: 'a1', voting_power: '200' },
      { actor_id: 'a2', voting_power: '50' },
    ];
    const chChain = makeChain(expected);
    const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
    const repo = new AnalyticsReadRepository(ch as never, { selectFrom: vi.fn() } as never);

    const result = await repo.currentVotingPowerByActor('dao-1', ['a1', 'a2']);

    expect(result).toEqual(expected);
    expect(chChain.execute).toHaveBeenCalledOnce();
  });
});
