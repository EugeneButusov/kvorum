import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { ArchiveDerivationRow } from '@libs/db';
import {
  DualGovernanceStateProjectionApplier,
  type DualGovernanceStateProjectionApplierDeps,
} from './state-projection-applier';

const CHAIN_ID = '0x1';
const TX = '0x' + 'cd'.repeat(32);
const BLOCK_HASH = '0x' + 'ab'.repeat(32);

function makeRow(overrides: Partial<ArchiveDerivationRow> = {}): ArchiveDerivationRow {
  return {
    id: 'row-1',
    dao_source_id: 'src-1',
    source_type: 'dual_governance',
    chain_id: CHAIN_ID,
    block_number: '23095715',
    block_hash: BLOCK_HASH,
    tx_hash: TX,
    log_index: 0,
    event_type: 'DualGovernanceStateChanged',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
    ...overrides,
  } as ArchiveDerivationRow;
}

const STATE_PAYLOAD = JSON.stringify({
  from: 'NotInitialized',
  to: 'Normal',
  context: {
    state: 'Normal',
    enteredAt: 1754648507,
    vetoSignallingActivatedAt: 0,
    signallingEscrow: '0x' + '11'.repeat(20),
    rageQuitRound: 0,
    vetoSignallingReactivationTime: 0,
    normalOrVetoCooldownExitedAt: 0,
    rageQuitEscrow: '0x' + '00'.repeat(20),
    configProvider: '0x' + '22'.repeat(20),
  },
});

function makeDeps(over: {
  payload?: string | undefined;
  daoId?: string | undefined;
  inserted?: boolean;
}): {
  deps: DualGovernanceStateProjectionApplierDeps;
  history: { insert: ReturnType<typeof vi.fn> };
  archive: {
    markDerived: ReturnType<typeof vi.fn>;
    incrementAttemptCount: ReturnType<typeof vi.fn>;
  };
  dlq: { insert: ReturnType<typeof vi.fn> };
} {
  const history = { insert: vi.fn().mockResolvedValue({ inserted: over.inserted ?? true }) };
  const archive = {
    markDerived: vi.fn().mockResolvedValue(undefined),
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
  };
  const dlq = { insert: vi.fn().mockResolvedValue(undefined) };
  const deps: DualGovernanceStateProjectionApplierDeps = {
    archive: archive as never,
    dlq: dlq as never,
    payloads: {
      fetchPayloads: vi.fn().mockResolvedValue(
        over.payload === undefined
          ? []
          : [
              {
                chain_id: CHAIN_ID,
                tx_hash: TX,
                log_index: 0,
                block_hash: BLOCK_HASH,
                event_type: 'DualGovernanceStateChanged',
                payload: over.payload,
                received_at: new Date(),
              },
            ],
      ),
    } as never,
    daoSources: {
      findDaoIdForSource: vi.fn().mockResolvedValue(over.daoId),
    } as never,
    history: history as never,
    metrics: { batchLookupSeconds: vi.fn(), processed: vi.fn() },
    logger: silentLogger,
  };
  return { deps, history, archive, dlq };
}

describe('DualGovernanceStateProjectionApplier', () => {
  it('declares the projection contract for dual_governance state events', () => {
    const { deps } = makeDeps({ payload: STATE_PAYLOAD, daoId: 'dao-1' });
    const applier = new DualGovernanceStateProjectionApplier(deps);
    expect(applier.kind).toBe('projection');
    expect(applier.sourceTypes).toEqual(['dual_governance']);
    expect(applier.eventTypes).toEqual(['DualGovernanceStateChanged']);
  });

  it('inserts a history row + marks the archive derived', async () => {
    const { deps, history, archive } = makeDeps({ payload: STATE_PAYLOAD, daoId: 'dao-1' });
    await new DualGovernanceStateProjectionApplier(deps).applyBatch([makeRow()]);
    expect(history.insert).toHaveBeenCalledWith(
      expect.objectContaining({ dao_id: 'dao-1', state: 'normal', log_index: 0 }),
    );
    expect(archive.markDerived).toHaveBeenCalledWith('row-1');
  });

  it('marks derived even when the row already existed (idempotent skip)', async () => {
    const { deps, archive } = makeDeps({ payload: STATE_PAYLOAD, daoId: 'dao-1', inserted: false });
    await new DualGovernanceStateProjectionApplier(deps).applyBatch([makeRow()]);
    expect(archive.markDerived).toHaveBeenCalledWith('row-1');
  });

  it('routes to the failure path when the payload is missing', async () => {
    const { deps, archive, history } = makeDeps({ payload: undefined, daoId: 'dao-1' });
    await new DualGovernanceStateProjectionApplier(deps).applyBatch([makeRow()]);
    expect(history.insert).not.toHaveBeenCalled();
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('row-1');
    expect(archive.markDerived).not.toHaveBeenCalled();
  });

  it('routes to the failure path on an unknown dao_source', async () => {
    const { deps, archive } = makeDeps({ payload: STATE_PAYLOAD, daoId: undefined });
    await new DualGovernanceStateProjectionApplier(deps).applyBatch([makeRow()]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('row-1');
    expect(archive.markDerived).not.toHaveBeenCalled();
  });

  it('routes to the failure path on a malformed payload (decode error)', async () => {
    const { deps, archive } = makeDeps({ payload: '{not json', daoId: 'dao-1' });
    await new DualGovernanceStateProjectionApplier(deps).applyBatch([makeRow()]);
    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('row-1');
  });

  it('is a no-op on an empty batch', async () => {
    const { deps, history } = makeDeps({ payload: STATE_PAYLOAD, daoId: 'dao-1' });
    await new DualGovernanceStateProjectionApplier(deps).applyBatch([]);
    expect(history.insert).not.toHaveBeenCalled();
  });
});
