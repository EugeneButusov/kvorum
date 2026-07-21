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

/** A chain whose successive `execute()` calls return successive queued results (one per chunk). */
function makeSeqChain<T>(results: T[]) {
  const execute = vi.fn();
  for (const r of results) execute.mockResolvedValueOnce(r);
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    execute,
    executeTakeFirst: vi.fn(),
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

  it('guard R5: chunks the address IN-list and folds an actor whose addresses cross a chunk boundary', async () => {
    // The delegation-flow endpoint calls this with every actor in the graph — ~20k addresses for
    // Compound — and a single ClickHouse IN-list of that size exceeds max_query_size (256 KiB) and
    // 500s. The list is chunked at CH_IN_LIST_CHUNK=2000; an actor whose two addresses land in
    // different chunks must still sum, which is what makes the per-chunk queries safe to fold.
    const CHUNK = 2000;
    const addressRows = [
      { address: '0xbig-first', actor_id: 'big' }, // chunk 0
      // Filler fills chunk 0 to exactly CHUNK entries, so the next address opens chunk 1.
      ...Array.from({ length: CHUNK - 1 }, (_, i) => ({
        address: `0xf${i}`,
        actor_id: `filler${i}`,
      })),
      { address: '0xbig-second', actor_id: 'big' }, // chunk 1
    ];
    const pgChain = makeChain(addressRows);
    const chChain = makeSeqChain([
      [{ delegator_address: '0xbig-first', voting_power: '100' }], // chunk 0 result
      [{ delegator_address: '0xbig-second', voting_power: '50' }], // chunk 1 result
    ]);
    const repo = new AnalyticsReadRepository(
      { selectFrom: vi.fn().mockReturnValue(chChain) } as never,
      { selectFrom: vi.fn().mockReturnValue(pgChain) } as never,
    );

    const result = await repo.currentVotingPowerByActor('dao-1', ['big']);

    expect(chChain.execute).toHaveBeenCalledTimes(2);
    expect(result).toContainEqual({ actor_id: 'big', voting_power: '150' });
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
