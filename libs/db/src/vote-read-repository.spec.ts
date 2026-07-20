import { describe, expect, it, vi } from 'vitest';
import { VoteReadRepository } from './vote-read-repository';

function makeChain<T>(result: T) {
  const chain = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    groupBy: vi.fn(),
    execute: vi.fn().mockResolvedValue(result),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.groupBy.mockReturnValue(chain);
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

  // Cheap CI guard for the same contract the integration spec proves against a real ClickHouse:
  // voting_power must never be selected as the bare UInt256 column. On a server with
  // output_format_json_quote_64bit_integers=0 (the managed production instance) the driver hands a
  // bare UInt256 back as a JS number, which loses precision and 500s the API's numeric cursor sort
  // (BigInt("5.8e+22") throws). toString() makes the read independent of that server setting.
  it.each([
    ['listForProposal', (repo: VoteReadRepository) => repo.listForProposal({ proposalId: 'p1' })],
    ['listForActor', (repo: VoteReadRepository) => repo.listForActor('a1')],
  ])(
    '%s selects voting_power via toString(), never the bare UInt256 column',
    async (_name, call) => {
      const chChain = makeChain([]);
      const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
      const pg = {
        selectFrom: vi.fn().mockImplementation((table: string) => {
          // listForProposal resolves the proposal; listForActor resolves the actor's addresses.
          if (table === 'proposal as p') return makeChain({ source_type: 's', source_id: '1' });
          if (table === 'actor_address') return makeChain([{ address: '0xabc' }]);
          return makeChain([]);
        }),
      };

      await call(new VoteReadRepository(pg as never, ch as never));

      const selected = chChain.select.mock.calls[0]?.[0] as unknown[];
      expect(selected).not.toContain('v.voting_power as voting_power_reported');
      expect(selected).not.toContain('v.voting_power');
    },
  );

  describe('tallyForProposals', () => {
    const repoWithCh = (chChain: ReturnType<typeof makeChain>) =>
      new VoteReadRepository(
        { selectFrom: vi.fn() } as never,
        {
          selectFrom: vi.fn().mockReturnValue(chChain),
        } as never,
      );

    it('short-circuits on an empty page without touching ClickHouse', async () => {
      const ch = { selectFrom: vi.fn() };
      const repo = new VoteReadRepository({ selectFrom: vi.fn() } as never, ch as never);

      await expect(repo.tallyForProposals([])).resolves.toEqual(new Map());
      expect(ch.selectFrom).not.toHaveBeenCalled();
    });

    it('aggregates a whole page in one query, keyed by proposal', async () => {
      const chChain = makeChain([
        { proposal_id: 'p1', primary_choice: 0, voting_power: '750', voter_count: '3' },
        { proposal_id: 'p1', primary_choice: 1, voting_power: '250', voter_count: '1' },
        { proposal_id: 'p2', primary_choice: 1, voting_power: '10', voter_count: '1' },
      ]);
      const ch = { selectFrom: vi.fn().mockReturnValue(chChain) };
      const repo = new VoteReadRepository({ selectFrom: vi.fn() } as never, ch as never);

      const out = await repo.tallyForProposals(['p1', 'p2']);

      // One round-trip for the page, not one per proposal — the reason this method exists.
      expect(ch.selectFrom).toHaveBeenCalledTimes(1);
      expect(chChain.where).toHaveBeenCalledWith('v.proposal_id', 'in', ['p1', 'p2']);
      expect(chChain.groupBy).toHaveBeenCalledWith(['v.proposal_id', 'v.primary_choice']);
      expect(out.get('p1')).toEqual([
        { primary_choice: 0, voting_power: '750', voter_count: 3 },
        { primary_choice: 1, voting_power: '250', voter_count: 1 },
      ]);
      expect(out.get('p2')).toEqual([{ primary_choice: 1, voting_power: '10', voter_count: 1 }]);
    });

    it('counts only live votes, never superseded ones', async () => {
      const chChain = makeChain([]);
      await repoWithCh(chChain).tallyForProposals(['p1']);

      expect(chChain.where).toHaveBeenCalledWith('v.superseded', '=', 0);
    });

    it('omits a proposal with no votes rather than mapping it to []', async () => {
      // The caller treats absent as "no tally to draw" (null), not an empty set of bars.
      const chChain = makeChain([
        { proposal_id: 'p1', primary_choice: 0, voting_power: '1', voter_count: '1' },
      ]);

      const out = await repoWithCh(chChain).tallyForProposals(['p1', 'p2']);

      expect(out.has('p2')).toBe(false);
    });

    it('keeps summed UInt256 power exact as a string, never a bare column', async () => {
      // Same contract the singular read is guarded for: on a server with
      // output_format_json_quote_64bit_integers=0 a bare UInt256 comes back as a JS number and
      // loses precision. sum() must be wrapped in toString(), so the value survives as a string.
      const huge = '12345678901234567890123456789';
      const chChain = makeChain([
        { proposal_id: 'p1', primary_choice: 1, voting_power: huge, voter_count: '1' },
      ]);

      const out = await repoWithCh(chChain).tallyForProposals(['p1']);

      const selected = chChain.select.mock.calls[0]?.[0] as unknown[];
      expect(selected).not.toContain('v.voting_power');
      expect(out.get('p1')?.[0]?.voting_power).toBe(huge);
      expect(BigInt(out.get('p1')![0]!.voting_power)).toBe(BigInt(huge));
    });

    it('coerces the driver’s count() to a number', async () => {
      // ClickHouse hands count() back as a string over the JSON interface.
      const chChain = makeChain([
        { proposal_id: 'p1', primary_choice: 0, voting_power: '5', voter_count: '42' },
      ]);

      const out = await repoWithCh(chChain).tallyForProposals(['p1']);

      expect(out.get('p1')?.[0]?.voter_count).toBe(42);
    });

    it('accepts a readonly id list without mutating the caller’s array', async () => {
      const ids: readonly string[] = Object.freeze(['p1']);
      const chChain = makeChain([]);

      await repoWithCh(chChain).tallyForProposals(ids);

      expect(chChain.where).toHaveBeenCalledWith('v.proposal_id', 'in', ['p1']);
      const passed = chChain.where.mock.calls.find((c) => c[0] === 'v.proposal_id')?.[2];
      expect(passed).not.toBe(ids);
    });
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
