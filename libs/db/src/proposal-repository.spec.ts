import { describe, expect, it, vi } from 'vitest';
import { ProposalRepository } from './proposal-repository';
import type { NewProposal, NewProposalChoice } from './schema/pg';

const NEW_PROPOSAL: NewProposal = {
  dao_id: 'dao-1',
  source_type: 'compound_governor_bravo',
  source_id: '42',
  proposer_actor_id: 'actor-1',
  description: 'proposal body',
  description_hash: 'a'.repeat(64),
  binding: true,
  voting_starts_at: null,
  voting_ends_at: null,
  voting_starts_block: '123',
  voting_ends_block: '456',
  voting_power_block: '123',
  state: 'pending',
  state_updated_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

function makeInsertChain(returnValue?: unknown) {
  let capturedValues: unknown;
  let capturedConstraint: string | undefined;
  let capturedColumns: readonly string[] | undefined;
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const execute = vi.fn().mockResolvedValue(undefined);
  const returning = vi.fn().mockReturnValue({ executeTakeFirst });
  const onConflict = vi.fn().mockImplementation((fn: (oc: ConflictBuilder) => unknown) => {
    fn({
      constraint: (name) => {
        capturedConstraint = name;
        return { doNothing: () => ({ returning, execute }) };
      },
      columns: (columns) => {
        capturedColumns = columns;
        return { doNothing: () => ({ returning, execute }) };
      },
    });
    return { returning, execute };
  });
  const values = vi.fn().mockImplementation((value: unknown) => {
    capturedValues = value;
    return { onConflict };
  });
  const insertInto = vi.fn().mockReturnValue({ values });

  return {
    insertInto,
    execute,
    executeTakeFirst,
    get capturedValues() {
      return capturedValues;
    },
    get capturedConstraint() {
      return capturedConstraint;
    },
    get capturedColumns() {
      return capturedColumns;
    },
  };
}

function makeUpdateChain(numUpdatedRows: bigint) {
  const executeTakeFirst = vi.fn().mockResolvedValue({ numUpdatedRows });
  const execute = vi.fn().mockResolvedValue(undefined);
  const where = vi.fn();
  const chain = { set: vi.fn(), where, executeTakeFirst, execute };
  chain.set.mockReturnValue(chain);
  where.mockReturnValue(chain);
  const updateTable = vi.fn().mockReturnValue(chain);

  return { updateTable, set: chain.set, where, executeTakeFirst, execute };
}

function makeSelectChain(returnValue: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const where = vi.fn().mockReturnValue({ executeTakeFirst });
  const select = vi.fn().mockReturnValue({ where });
  const selectFrom = vi.fn().mockReturnValue({ select });

  return { selectFrom, select, where, executeTakeFirst };
}

function makePendingTimestampSelectChain(returnValue: unknown[]) {
  const execute = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    execute,
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  const selectFrom = vi.fn().mockReturnValue(chain);

  return { selectFrom, ...chain };
}

interface ConflictBuilder {
  constraint(name: string): { doNothing(): unknown };
  columns(columns: readonly string[]): { doNothing(): unknown };
}

describe('ProposalRepository', () => {
  it('finds dao_id for a dao_source row', async () => {
    const select = makeSelectChain({ dao_id: 'dao-1' });
    const repo = new ProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.findDaoIdForSource('source-1')).resolves.toBe('dao-1');

    expect(select.selectFrom).toHaveBeenCalledWith('dao_source');
    expect(select.select).toHaveBeenCalledWith('dao_id');
    expect(select.where).toHaveBeenCalledWith('id', '=', 'source-1');
  });

  it('finds proposal by dao/source tuple', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ id: 'proposal-1', source_id: '42' });
    const where = vi.fn();
    const chain = {
      selectAll: vi.fn(),
      where,
      executeTakeFirst,
    };
    chain.selectAll.mockReturnValue(chain);
    where.mockReturnValue(chain);
    const selectFrom = vi.fn().mockReturnValue(chain);
    const repo = new ProposalRepository({ selectFrom } as never);

    await expect(
      repo.findBySource({ daoId: 'dao-1', sourceType: 'compound_governor_bravo', sourceId: '42' }),
    ).resolves.toMatchObject({ id: 'proposal-1' });

    expect(selectFrom).toHaveBeenCalledWith('proposal');
    expect(chain.selectAll).toHaveBeenCalled();
    expect(where.mock.calls).toEqual([
      ['dao_id', '=', 'dao-1'],
      ['source_type', '=', 'compound_governor_bravo'],
      ['source_id', '=', '42'],
    ]);
  });

  it('finds proposal id by dao/source tuple', async () => {
    const repo = new ProposalRepository({} as never);
    const findBySource = vi
      .spyOn(repo, 'findBySource')
      .mockResolvedValue({ id: 'proposal-1' } as never);

    await expect(repo.findIdBySource('dao-1', 'compound_governor_bravo', '42')).resolves.toBe(
      'proposal-1',
    );
    expect(findBySource).toHaveBeenCalledWith({
      daoId: 'dao-1',
      sourceType: 'compound_governor_bravo',
      sourceId: '42',
    });
  });

  it('inserts proposal with idempotency conflict handling', async () => {
    const insert = makeInsertChain({ id: 'proposal-1' });
    const repo = new ProposalRepository({ insertInto: insert.insertInto } as never);

    await expect(repo.insertProposal(NEW_PROPOSAL)).resolves.toEqual({
      inserted: true,
      proposalId: 'proposal-1',
    });

    expect(insert.insertInto).toHaveBeenCalledWith('proposal');
    expect(insert.capturedValues).toEqual(NEW_PROPOSAL);
    expect(insert.capturedConstraint).toBe('proposal_dao_id_source_type_source_id_key');
  });

  it('reports idempotent proposal insert conflict', async () => {
    const insert = makeInsertChain(undefined);
    const repo = new ProposalRepository({ insertInto: insert.insertInto } as never);

    await expect(repo.insertProposal(NEW_PROPOSAL)).resolves.toEqual({ inserted: false });
  });

  it('inserts normalized proposal actions with action_index conflict handling', async () => {
    const insert = makeInsertChain();
    const repo = new ProposalRepository({ insertInto: insert.insertInto } as never);

    await repo.insertActions('proposal-1', [
      {
        targetAddress: '0xABCDEF',
        targetChainId: '0x1',
        valueWei: '10',
        functionSignature: '_setPendingAdmin(address)',
        calldata: '0x1234',
      },
    ]);

    expect(insert.insertInto).toHaveBeenCalledWith('proposal_action');
    expect(insert.capturedValues).toEqual([
      {
        proposal_id: 'proposal-1',
        action_index: 0,
        target_address: '0xabcdef',
        target_chain_id: '0x1',
        value_wei: '10',
        function_signature: '_setPendingAdmin(address)',
        calldata: '0x1234',
      },
    ]);
    expect(insert.capturedColumns).toEqual(['proposal_id', 'action_index']);
  });

  it('does not issue an insert for empty action batches', async () => {
    const insert = makeInsertChain();
    const repo = new ProposalRepository({ insertInto: insert.insertInto } as never);

    await repo.insertActions('proposal-1', []);

    expect(insert.insertInto).not.toHaveBeenCalled();
  });

  it('ensures proposal choices for the requested proposal id', async () => {
    const insert = makeInsertChain();
    const repo = new ProposalRepository({ insertInto: insert.insertInto } as never);
    const choices: NewProposalChoice[] = [
      { proposal_id: 'ignored', choice_index: 0, value: 'Against' },
      { proposal_id: 'ignored', choice_index: 1, value: 'For' },
    ];

    await repo.ensureChoices('proposal-1', choices);

    expect(insert.insertInto).toHaveBeenCalledWith('proposal_choice');
    expect(insert.capturedValues).toEqual([
      { proposal_id: 'proposal-1', choice_index: 0, value: 'Against' },
      { proposal_id: 'proposal-1', choice_index: 1, value: 'For' },
    ]);
    expect(insert.capturedColumns).toEqual(['proposal_id', 'choice_index']);
  });

  it('advances state with terminal-state and expected-current-state guards', async () => {
    const update = makeUpdateChain(1n);
    const repo = new ProposalRepository({ updateTable: update.updateTable } as never);
    const stateUpdatedAt = new Date('2026-01-01T00:00:00Z');

    await expect(
      repo.advanceState({
        daoId: 'dao-1',
        sourceType: 'compound_governor_bravo',
        sourceId: '42',
        targetState: 'executed',
        stateUpdatedAt,
      }),
    ).resolves.toBe(1);

    expect(update.updateTable).toHaveBeenCalledWith('proposal');
    expect(update.where.mock.calls).toEqual([
      ['dao_id', '=', 'dao-1'],
      ['source_type', '=', 'compound_governor_bravo'],
      ['source_id', '=', '42'],
      ['state', 'not in', ['executed', 'canceled']],
      ['state', 'in', ['pending', 'queued']],
    ]);
  });

  it('only queues pending proposals', async () => {
    const update = makeUpdateChain(0n);
    const repo = new ProposalRepository({ updateTable: update.updateTable } as never);

    await repo.advanceState({
      daoId: 'dao-1',
      sourceType: 'compound_governor_bravo',
      sourceId: '42',
      targetState: 'queued',
      stateUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(update.where.mock.calls.at(-1)).toEqual(['state', 'in', ['pending']]);
    expect(update.set).toHaveBeenCalledWith({
      state: 'queued',
      state_updated_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: expect.anything(),
    });
  });

  it('finds proposals pending lazy timestamp fill', async () => {
    const expected = [
      {
        id: 'proposal-1',
        chain_id: '0x1',
        voting_starts_block: '123',
        voting_starts_at: null,
        voting_ends_block: '456',
        voting_ends_at: null,
      },
    ];
    const select = makePendingTimestampSelectChain(expected);
    const repo = new ProposalRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.findPendingTimestampFill(25)).resolves.toEqual(expected);

    expect(select.selectFrom).toHaveBeenCalledWith('proposal');
    expect(select.innerJoin).toHaveBeenCalledWith('dao', 'dao.id', 'proposal.dao_id');
    expect(select.limit).toHaveBeenCalledWith(25);
  });

  it('fills timestamps idempotently', async () => {
    const update = makeUpdateChain(1n);
    const repo = new ProposalRepository({ updateTable: update.updateTable } as never);
    const startsAt = new Date('2026-01-01T00:00:00Z');

    await repo.fillTimestamps([
      { id: 'proposal-1', voting_starts_at: startsAt, voting_ends_at: null },
    ]);

    expect(update.updateTable).toHaveBeenCalledWith('proposal');
    expect(update.set).toHaveBeenCalledWith(expect.any(Function));
    expect(update.where).toHaveBeenCalledWith('id', '=', 'proposal-1');
    expect(update.execute).toHaveBeenCalledOnce();
  });
});
