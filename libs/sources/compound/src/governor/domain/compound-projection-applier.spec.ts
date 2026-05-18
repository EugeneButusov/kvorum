import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import type { CompoundArchivePayloadRow } from '../persistence/compound-archive-payload-repository';
import { CompoundProjectionApplier } from './compound-projection-applier';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'compound_governor',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'ProposalCreated',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const CREATED_PAYLOAD: CompoundArchivePayloadRow = {
  chain_id: '0x1',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'ProposalCreated',
  payload: JSON.stringify({
    proposalId: '42',
    proposer: '0xabcdef',
    targets: ['0x1111111111111111111111111111111111111111'],
    values: ['0'],
    signatures: ['_setPendingAdmin(address)'],
    calldatas: ['0x1234'],
    startBlock: '200',
    endBlock: '300',
    description: '# Title\nBody',
  }),
  received_at: new Date('2026-01-01T00:00:00Z'),
};

function makeMetrics() {
  return {
    batchLookupSeconds: vi.fn(),
    processed: vi.fn(),
  };
}

interface ProjectionTxOptions {
  proposalInserted?: boolean;
}

function makeProjectionTx(options: ProjectionTxOptions = {}) {
  const calls = {
    insertedProposal: undefined as unknown,
    insertedActions: undefined as unknown,
    insertedChoices: undefined as unknown,
    markedDerivedId: undefined as string | undefined,
    transactionCount: 0,
  };
  const proposalInserted = options.proposalInserted ?? true;

  function chain<T extends object>(methods: T): T {
    return methods;
  }

  const tx = {
    selectFrom: vi.fn(() =>
      chain({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue({ dao_id: 'dao-1' }),
      }),
    ),
    insertInto: vi.fn((table: string) =>
      chain({
        values: vi.fn(function (this: unknown, values: unknown) {
          if (table === 'proposal') calls.insertedProposal = values;
          if (table === 'proposal_action') calls.insertedActions = values;
          if (table === 'proposal_choice') calls.insertedChoices = values;
          return this;
        }),
        onConflict: vi.fn().mockReturnThis(),
        returningAll: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn(async () => {
          if (table === 'actor') return { id: 'actor-1' };
          if (table === 'proposal') {
            return proposalInserted ? { id: 'proposal-1' } : undefined;
          }
          return undefined;
        }),
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    ),
    updateTable: vi.fn((table: string) =>
      chain({
        set: vi.fn().mockReturnThis(),
        where: vi.fn(function (this: unknown, column: string, _operator: string, value: unknown) {
          if (table === 'archive_confirmation' && column === 'id') {
            calls.markedDerivedId = String(value);
          }
          return this;
        }),
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    ),
  };

  const pgDb = {
    transaction: vi.fn(() => ({
      execute: vi.fn((fn: (arg: typeof tx) => Promise<unknown>) => {
        calls.transactionCount += 1;
        return fn(tx);
      }),
    })),
  };

  return { pgDb, tx, calls };
}

describe('CompoundProjectionApplier', () => {
  it('supports both compound governor source types', () => {
    const applier = new CompoundProjectionApplier({
      pgDb: {} as never,
      chDb: {} as never,
      archive: {} as never,
      payloads: {} as never,
      metrics: makeMetrics(),
    });

    expect(applier.sourceTypes).toEqual(['compound_governor', 'compound_governor_alpha']);
  });

  it('projects ProposalCreated inside one transaction and marks archive row derived', async () => {
    const { pgDb, tx, calls } = makeProjectionTx();
    const archive = {
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    };
    const payloads = {
      fetchPayloads: vi.fn().mockResolvedValue([CREATED_PAYLOAD]),
    };
    const metrics = makeMetrics();

    const applier = new CompoundProjectionApplier({
      pgDb: pgDb as never,
      chDb: {} as never,
      archive: archive as never,
      payloads: payloads as never,
      metrics,
    });

    await applier.applyBatch([ROW]);

    expect(payloads.fetchPayloads).toHaveBeenCalledWith([ROW]);
    expect(metrics.batchLookupSeconds).toHaveBeenCalledWith(expect.any(Number));
    expect(calls.transactionCount).toBe(1);
    expect(tx.selectFrom).toHaveBeenCalledWith('dao_source');
    expect(tx.insertInto).toHaveBeenCalledWith('actor');
    expect(tx.insertInto).toHaveBeenCalledWith('proposal');
    expect(calls.insertedProposal).toEqual(
      expect.objectContaining({
        dao_id: 'dao-1',
        proposer_actor_id: 'actor-1',
        source_id: '42',
        voting_starts_block: '200',
        voting_ends_block: '300',
      }),
    );
    expect(calls.insertedActions).toEqual(expect.any(Array));
    expect(calls.insertedChoices).toEqual(expect.any(Array));
    expect(calls.markedDerivedId).toBe('archive-1');
    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'derived', reason: null }),
    );
  });

  it('does not write children when ProposalCreated is idempotent', async () => {
    const { pgDb, calls } = makeProjectionTx({ proposalInserted: false });
    const applier = new CompoundProjectionApplier({
      pgDb: pgDb as never,
      chDb: {} as never,
      archive: { incrementAttemptCount: vi.fn() } as never,
      payloads: {
        fetchPayloads: vi.fn().mockResolvedValue([CREATED_PAYLOAD]),
      } as never,
      metrics: makeMetrics(),
    });

    await applier.applyBatch([ROW]);

    expect(calls.insertedActions).toBeUndefined();
    expect(calls.insertedChoices).toBeUndefined();
    expect(calls.markedDerivedId).toBe('archive-1');
  });

  it('increments attempt count when archive payload JSON cannot be decoded', async () => {
    const archive = {
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    };
    const applier = new CompoundProjectionApplier({
      pgDb: makeProjectionTx().pgDb as never,
      chDb: {} as never,
      archive: archive as never,
      payloads: {
        fetchPayloads: vi.fn().mockResolvedValue([{ ...CREATED_PAYLOAD, payload: '{' }]),
      } as never,
      metrics: makeMetrics(),
    });

    await applier.applyBatch([ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
  });

  it('increments attempt count when archive payload is missing', async () => {
    const archive = {
      incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = makeMetrics();
    const { pgDb, calls } = makeProjectionTx();
    const applier = new CompoundProjectionApplier({
      pgDb: pgDb as never,
      chDb: {} as never,
      archive: archive as never,
      payloads: { fetchPayloads: vi.fn().mockResolvedValue([]) } as never,
      metrics,
    });

    await applier.applyBatch([ROW]);

    expect(calls.transactionCount).toBe(0);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', reason: 'ch_missing' }),
    );
  });
});
