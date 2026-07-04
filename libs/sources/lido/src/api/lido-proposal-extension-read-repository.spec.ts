import { describe, expect, it, vi } from 'vitest';
import { LidoProposalExtensionReadRepository } from './lido-proposal-extension-read-repository';

function mockPg(row: Record<string, unknown> | undefined) {
  const builder: Record<string, unknown> = {};
  for (const m of ['selectAll', 'where']) builder[m] = vi.fn(() => builder);
  builder['executeTakeFirst'] = vi.fn().mockResolvedValue(row);
  const selectFrom = vi.fn(() => builder);
  return { db: { selectFrom } as never, selectFrom, builder };
}

describe('LidoProposalExtensionReadRepository', () => {
  it('maps aragon_voting metadata (10^18 pct params, phase times as ISO seconds)', async () => {
    const { db, selectFrom } = mockPg({
      proposal_id: 'p1',
      app_address: '0xVOTING',
      app_version: '4',
      support_required_pct: '500000000000000000',
      min_accept_quorum_pct: '50000000000000000',
      main_phase_ends_at: new Date('2026-05-15T10:00:00.999Z'),
      objection_phase_ends_at: new Date('2026-05-16T10:00:00.000Z'),
      executed_at: null,
      last_reconcile_check_block: null,
    });
    const repo = new LidoProposalExtensionReadRepository(db);

    const ext = await repo.getExtension('p1', 'aragon_voting');
    expect(selectFrom).toHaveBeenCalledWith('aragon_proposal_metadata');
    expect(ext).toEqual({
      voting: null,
      payloads: [],
      metadata: {
        kind: 'aragon_voting',
        app_address: '0xVOTING',
        app_version: '4',
        support_required_pct: '500000000000000000',
        min_accept_quorum_pct: '50000000000000000',
        main_phase_ends_at: '2026-05-15T10:00:00Z',
        objection_phase_ends_at: '2026-05-16T10:00:00Z',
        executed_at: null,
      },
    });
  });

  it('maps dual_governance ledger metadata', async () => {
    const { db, selectFrom } = mockPg({
      dg_proposal_id: '7',
      proposal_id: 'p2',
      origin: 'direct',
      aragon_source_id: null,
      executor: '0xEXEC',
      status: 'scheduled',
      submitted_at: new Date('2026-05-15T10:00:00Z'),
      scheduled_at: new Date('2026-05-16T10:00:00Z'),
      executed_at: null,
      cancelled_at: null,
    });
    const repo = new LidoProposalExtensionReadRepository(db);

    const ext = await repo.getExtension('p2', 'dual_governance');
    expect(selectFrom).toHaveBeenCalledWith('dual_governance_proposal');
    expect(ext?.metadata).toEqual({
      kind: 'dual_governance',
      origin: 'direct',
      dg_proposal_id: '7',
      status: 'scheduled',
      executor: '0xEXEC',
      aragon_source_id: null,
      submitted_at: '2026-05-15T10:00:00Z',
      scheduled_at: '2026-05-16T10:00:00Z',
      executed_at: null,
      cancelled_at: null,
    });
  });

  it('maps easy_track motion metadata', async () => {
    const { db, selectFrom } = mockPg({
      proposal_id: 'p3',
      motion_id: '99',
      factory_address: '0xFACTORY',
      objection_ends_at: new Date('2026-05-18T10:00:00Z'),
      state: 'active',
      last_reconcile_check_block: null,
    });
    const repo = new LidoProposalExtensionReadRepository(db);

    const ext = await repo.getExtension('p3', 'easy_track');
    expect(selectFrom).toHaveBeenCalledWith('easy_track_motion_meta');
    expect(ext?.metadata).toEqual({
      kind: 'easy_track',
      motion_id: '99',
      factory_address: '0xFACTORY',
      objection_ends_at: '2026-05-18T10:00:00Z',
      state: 'active',
    });
  });

  it('returns null when the metadata row is missing', async () => {
    const { db } = mockPg(undefined);
    const repo = new LidoProposalExtensionReadRepository(db);
    await expect(repo.getExtension('p1', 'aragon_voting')).resolves.toBeNull();
  });

  it('returns null for an unrelated source_type', async () => {
    const { db, selectFrom } = mockPg({ proposal_id: 'p1' });
    const repo = new LidoProposalExtensionReadRepository(db);
    await expect(repo.getExtension('p1', 'compound_governor_bravo')).resolves.toBeNull();
    expect(selectFrom).not.toHaveBeenCalled();
  });
});
