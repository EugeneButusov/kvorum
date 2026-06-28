import { describe, expect, it } from 'vitest';
import { DualGovernanceProposalRepository } from './dg-proposal-repository';
import type { DualGovernanceProposal, NewDualGovernanceProposal } from '../../persistence/schema';

type Call = [string, unknown[]];

function makeChain(
  terminal: { execute?: unknown; executeTakeFirst?: unknown },
  calls: Call[],
): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'execute') return () => Promise.resolve(terminal.execute);
        if (prop === 'executeTakeFirst') return () => Promise.resolve(terminal.executeTakeFirst);
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          if (prop === 'onConflict' && typeof args[0] === 'function') {
            (args[0] as (b: unknown) => unknown)({
              columns: () => ({ doNothing: () => undefined }),
            });
          }
          return chain;
        };
      },
    },
  );
  return chain;
}

const ROW: DualGovernanceProposal = {
  id: 'dgp-1',
  dao_id: 'dao-1',
  dg_proposal_id: '3',
  proposal_id: 'prop-1',
  origin: 'aragon',
  aragon_source_id: '201',
  executor: '0x' + '23'.repeat(20),
  calls_hash: '0x' + 'ab'.repeat(32),
  submitted_tx_hash: '0x' + 'cd'.repeat(32),
  submitted_block: '23095715',
  submitted_at: new Date('2026-01-01T00:00:00Z'),
  status: 'submitted',
  scheduled_at: null,
  executed_at: null,
  cancelled_at: null,
  last_reconcile_check_block: null,
};

const NEW_ROW: NewDualGovernanceProposal = {
  dao_id: 'dao-1',
  dg_proposal_id: '3',
  proposal_id: 'prop-1',
  origin: 'aragon',
  aragon_source_id: '201',
  executor: ROW.executor,
  calls_hash: ROW.calls_hash,
  submitted_tx_hash: ROW.submitted_tx_hash,
  submitted_block: '23095715',
  submitted_at: ROW.submitted_at,
  status: 'submitted',
  scheduled_at: null,
  executed_at: null,
  cancelled_at: null,
  last_reconcile_check_block: null,
};

describe('DualGovernanceProposalRepository', () => {
  it('upsertSubmission returns inserted=true with the new row', async () => {
    const calls: Call[] = [];
    const db = { insertInto: () => makeChain({ executeTakeFirst: ROW }, calls) } as never;
    const result = await new DualGovernanceProposalRepository(db).upsertSubmission(NEW_ROW);
    expect(result).toEqual({ inserted: true, row: ROW });
    expect(calls).toContainEqual(['onConflict', [expect.any(Function)]]);
  });

  it('upsertSubmission returns inserted=false and the existing row on conflict', async () => {
    const calls: Call[] = [];
    const db = {
      insertInto: () => makeChain({ executeTakeFirst: undefined }, calls),
      selectFrom: () => makeChain({ executeTakeFirst: ROW }, calls),
    } as never;
    const result = await new DualGovernanceProposalRepository(db).upsertSubmission(NEW_ROW);
    expect(result).toEqual({ inserted: false, row: ROW });
  });

  it('findByDgId reads by (dao_id, dg_proposal_id)', async () => {
    const calls: Call[] = [];
    const db = { selectFrom: () => makeChain({ executeTakeFirst: ROW }, calls) } as never;
    await expect(
      new DualGovernanceProposalRepository(db).findByDgId('dao-1', '3'),
    ).resolves.toEqual(ROW);
    expect(calls).toContainEqual(['where', ['dao_id', '=', 'dao-1']]);
    expect(calls).toContainEqual(['where', ['dg_proposal_id', '=', '3']]);
  });

  it('markScheduled advances status=scheduled (from submitted) then returns the row', async () => {
    const calls: Call[] = [];
    const scheduled = { ...ROW, status: 'scheduled' as const };
    const db = {
      updateTable: () => makeChain({ execute: {} }, calls),
      selectFrom: () => makeChain({ executeTakeFirst: scheduled }, calls),
    } as never;
    const at = new Date('2026-01-03T00:00:00Z');
    await expect(
      new DualGovernanceProposalRepository(db).markScheduled('dao-1', '3', at),
    ).resolves.toEqual(scheduled);
    expect(calls).toContainEqual(['set', [{ status: 'scheduled', scheduled_at: at }]]);
    expect(calls).toContainEqual(['where', ['status', '=', 'submitted']]);
  });

  it('markExecuted advances status=executed (from submitted/scheduled)', async () => {
    const calls: Call[] = [];
    const executed = { ...ROW, status: 'executed' as const };
    const db = {
      updateTable: () => makeChain({ execute: {} }, calls),
      selectFrom: () => makeChain({ executeTakeFirst: executed }, calls),
    } as never;
    const at = new Date('2026-01-04T00:00:00Z');
    await expect(
      new DualGovernanceProposalRepository(db).markExecuted('dao-1', '3', at),
    ).resolves.toEqual(executed);
    expect(calls).toContainEqual(['where', ['status', 'in', ['submitted', 'scheduled']]]);
  });

  it('cancelThrough cancels the non-terminal range and returns affected rows', async () => {
    const calls: Call[] = [];
    const affected = [{ ...ROW, status: 'cancelled' as const }];
    const db = { updateTable: () => makeChain({ execute: affected }, calls) } as never;
    const at = new Date('2026-01-05T00:00:00Z');
    await expect(
      new DualGovernanceProposalRepository(db).cancelThrough('dao-1', '5', at),
    ).resolves.toEqual(affected);
    expect(calls).toContainEqual(['where', ['dg_proposal_id', '<=', '5']]);
    expect(calls).toContainEqual(['where', ['status', 'not in', ['executed', 'cancelled']]]);
  });

  it('findResolvableByDao returns every non-executed row for the dao (vetoed candidates)', async () => {
    const calls: Call[] = [];
    const rows = [ROW, { ...ROW, id: 'dgp-2', status: 'cancelled' as const }];
    const db = { selectFrom: () => makeChain({ execute: rows }, calls) } as never;
    await expect(
      new DualGovernanceProposalRepository(db).findResolvableByDao('dao-1'),
    ).resolves.toEqual(rows);
    expect(calls).toContainEqual(['where', ['dao_id', '=', 'dao-1']]);
    expect(calls).toContainEqual(['where', ['status', '<>', 'executed']]);
  });
});
