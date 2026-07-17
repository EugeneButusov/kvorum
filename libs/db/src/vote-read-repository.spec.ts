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
