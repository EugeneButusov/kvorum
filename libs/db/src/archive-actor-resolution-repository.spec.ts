import { describe, expect, it, vi } from 'vitest';
import { ArchiveActorResolutionRepository } from './archive-actor-resolution-repository';
import type { ArchiveDerivationRow } from './archive-derivation-repository';

const ARCHIVE_ROW: ArchiveDerivationRow = {
  id: 'row-1',
  source_type: 'compound_governor_bravo',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'ProposalCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 2,
};

function makeSelectChain(returnValue: unknown[]) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    execute,
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  const selectFrom = vi.fn().mockReturnValue(chain);

  return { selectFrom, ...chain };
}

function makeUpdateChain() {
  const execute = vi.fn().mockResolvedValue(undefined);
  const where = vi.fn().mockReturnValue({ execute });
  const set = vi.fn().mockReturnValue({ where });
  const updateTable = vi.fn().mockReturnValue({ set });

  return { updateTable, where };
}

function makeUpdateReturningChain(returnValue: unknown) {
  const executeTakeFirstOrThrow = vi.fn().mockResolvedValue(returnValue);
  const returning = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const updateTable = vi.fn().mockReturnValue({ set });

  return { updateTable, where, returning };
}

describe('ArchiveActorResolutionRepository', () => {
  it('finds derivable rows only when actor watermark is set', async () => {
    const pgSelect = makeSelectChain([ARCHIVE_ROW]);
    const repo = new ArchiveActorResolutionRepository({ selectFrom: pgSelect.selectFrom } as never);

    await expect(repo.findDerivableBy(['VoteCast'], 10)).resolves.toEqual([ARCHIVE_ROW]);

    // external_id IS NULL restricts to EVM rows (ADR-071) so coords are non-null.
    expect(pgSelect.where).toHaveBeenCalledWith('external_id', 'is', null);
    expect(pgSelect.where).toHaveBeenCalledWith('derived_at', 'is', null);
    expect(pgSelect.where).toHaveBeenCalledWith('derivation_actor_resolved_at', 'is not', null);
    expect(pgSelect.where).toHaveBeenCalledWith('event_type', 'in', ['VoteCast']);
  });

  it('short-circuits derivable lookup for empty event type list', async () => {
    const pgSelect = makeSelectChain([ARCHIVE_ROW]);
    const repo = new ArchiveActorResolutionRepository({ selectFrom: pgSelect.selectFrom } as never);

    await expect(repo.findDerivableBy([], 10)).resolves.toEqual([]);
    expect(pgSelect.selectFrom).not.toHaveBeenCalled();
  });

  it('selects unresolved actor rows by actor-sweep contract', async () => {
    const pgSelect = makeSelectChain([ARCHIVE_ROW]);
    const repo = new ArchiveActorResolutionRepository({ selectFrom: pgSelect.selectFrom } as never);

    await expect(
      repo.findUnresolvedActors(['VoteCast', 'DelegateChanged', 'DelegateVotesChanged'], 5, 25),
    ).resolves.toEqual([ARCHIVE_ROW]);

    expect(pgSelect.where).toHaveBeenCalledWith('external_id', 'is', null);
    expect(pgSelect.where).toHaveBeenCalledWith('derivation_actor_resolved_at', 'is', null);
    expect(pgSelect.where).toHaveBeenCalledWith('event_type', 'in', [
      'VoteCast',
      'DelegateChanged',
      'DelegateVotesChanged',
    ]);
    expect(pgSelect.where).toHaveBeenCalledWith('actor_resolution_attempt_count', '<', 5);
  });

  it('short-circuits unresolved actor lookup for empty event type list', async () => {
    const pgSelect = makeSelectChain([ARCHIVE_ROW]);
    const repo = new ArchiveActorResolutionRepository({ selectFrom: pgSelect.selectFrom } as never);

    await expect(repo.findUnresolvedActors([], 5, 10)).resolves.toEqual([]);
    expect(pgSelect.selectFrom).not.toHaveBeenCalled();
  });

  it('marks a row actor-resolved', async () => {
    const update = makeUpdateChain();
    const repo = new ArchiveActorResolutionRepository({ updateTable: update.updateTable } as never);

    await repo.markActorResolved('row-1');

    expect(update.updateTable).toHaveBeenCalledWith('archive_event');
    expect(update.where).toHaveBeenCalledWith('id', '=', 'row-1');
  });

  it('increments actor-resolution attempt count and returns the next value', async () => {
    const update = makeUpdateReturningChain({ actor_resolution_attempt_count: 3 });
    const repo = new ArchiveActorResolutionRepository({ updateTable: update.updateTable } as never);

    await expect(repo.incrementActorResolutionAttemptCount('row-1')).resolves.toBe(3);

    expect(update.updateTable).toHaveBeenCalledWith('archive_event');
    expect(update.where).toHaveBeenCalledWith('id', '=', 'row-1');
    expect(update.returning).toHaveBeenCalledWith('actor_resolution_attempt_count');
  });

  // KNOWN-028: a held row must step aside so it stops pinning the head of the block-ordered queue.
  describe('hold back-off filter', () => {
    /** Runs the predicate the repo passed to `.where(fn)` against a probe expression builder. */
    function capturePredicate(select: ReturnType<typeof makeSelectChain>) {
      const predicate = select.where.mock.calls
        .map((call) => call[0])
        .find((arg): arg is (eb: unknown) => unknown => typeof arg === 'function');
      expect(predicate).toBeDefined();

      const calls: unknown[][] = [];
      const eb = Object.assign(
        (...args: unknown[]) => {
          calls.push(args);
          return `cmp:${String(args[0])}`;
        },
        { or: vi.fn((branches: unknown[]) => ({ or: branches })) },
      );
      const result = predicate!(eb);
      return { calls, or: eb.or, result };
    }

    it('#1 — findDerivableBy admits un-held rows and rows whose hold has elapsed', async () => {
      const select = makeSelectChain([ARCHIVE_ROW]);
      const repo = new ArchiveActorResolutionRepository({ selectFrom: select.selectFrom } as never);
      const now = new Date('2026-01-01T00:05:00Z');

      await repo.findDerivableBy(['ProposalCreated'], 50, now);
      const { calls, or } = capturePredicate(select);

      expect(or).toHaveBeenCalledTimes(1);
      // null hold → never deferred; hold <= now → back-off elapsed, safe to retry.
      expect(calls).toEqual([
        ['derivation_hold_until', 'is', null],
        ['derivation_hold_until', '<=', now],
      ]);
    });

    it('#2 — findDerivableByOffchain applies the same filter', async () => {
      const select = makeSelectChain([]);
      const repo = new ArchiveActorResolutionRepository({ selectFrom: select.selectFrom } as never);
      const now = new Date('2026-01-01T00:05:00Z');

      await repo.findDerivableByOffchain(['ProposalCreated'], 50, now);
      const { calls, or } = capturePredicate(select);

      expect(or).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([
        ['derivation_hold_until', 'is', null],
        ['derivation_hold_until', '<=', now],
      ]);
    });

    it('#3 — the actor-sweep queries are untouched by the hold (holds are a derivation concern)', async () => {
      const select = makeSelectChain([]);
      const repo = new ArchiveActorResolutionRepository({ selectFrom: select.selectFrom } as never);

      await repo.findUnresolvedActors(['ProposalCreated'], 5, 50);

      const hasPredicate = select.where.mock.calls.some(([arg]) => typeof arg === 'function');
      expect(hasPredicate).toBe(false);
    });
  });
});
