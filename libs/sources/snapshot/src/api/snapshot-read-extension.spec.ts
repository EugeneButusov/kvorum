import { describe, expect, it, vi } from 'vitest';
import type { SnapshotProposalMetadataView } from './proposal-metadata-view';
import { makeSnapshotReadExtension } from './snapshot-read-extension';

function metaRow(votingType: string): Record<string, unknown> {
  return {
    proposal_id: 'p1',
    space_id: 'lido-snapshot.eth',
    voting_type: votingType,
    strategies: null,
    ipfs_hash: null,
    network: '1',
    scores_state: 'final',
    flagged: false,
  };
}

function mockPg(row: Record<string, unknown> | undefined) {
  const builder: Record<string, unknown> = {};
  for (const m of ['selectAll', 'where']) builder[m] = vi.fn(() => builder);
  builder['executeTakeFirst'] = vi.fn().mockResolvedValue(row);
  const selectFrom = vi.fn(() => builder);
  return { db: { selectFrom } as never };
}

function mockCh(rows: Array<Record<string, unknown>>) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'where']) builder[m] = vi.fn(() => builder);
  builder['execute'] = vi.fn().mockResolvedValue(rows);
  const selectFrom = vi.fn(() => builder);
  return { chDb: { selectFrom } as never, selectFrom };
}

const scoresOf = (
  ext: Awaited<ReturnType<ReturnType<typeof makeSnapshotReadExtension>['getProposalExtension']>>,
) => (ext?.metadata as SnapshotProposalMetadataView | null)?.choice_scores;

describe('makeSnapshotReadExtension.getProposalExtension', () => {
  it('enriches an approval proposal with per-choice scores from the breakdown', async () => {
    const { db } = mockPg(metaRow('approval'));
    const { chDb } = mockCh([
      { vote_id: 'v1', choices: '[{"choice_index":0,"weight":"1.0"}]', vp: '100', version: '1' },
      { vote_id: 'v2', choices: '[{"choice_index":1,"weight":"1.0"}]', vp: '40', version: '1' },
    ]);
    const ext = makeSnapshotReadExtension(db, chDb);

    expect(scoresOf(await ext.getProposalExtension('p1', 'snapshot'))).toEqual([100, 40]);
  });

  it('leaves choice_scores null (and skips the CH query) for single-choice proposals', async () => {
    const { db } = mockPg(metaRow('single-choice'));
    const { chDb, selectFrom } = mockCh([]);
    const ext = makeSnapshotReadExtension(db, chDb);

    expect(scoresOf(await ext.getProposalExtension('p1', 'snapshot'))).toBeNull();
    expect(selectFrom).not.toHaveBeenCalled(); // no aggregation for a type primary_choice can tally
  });

  it('returns null for a non-snapshot source_type', async () => {
    const { db } = mockPg(metaRow('approval'));
    const { chDb } = mockCh([]);
    const ext = makeSnapshotReadExtension(db, chDb);

    expect(await ext.getProposalExtension('p1', 'compound_governor_bravo')).toBeNull();
  });

  it('returns the extension unchanged when the metadata row is missing', async () => {
    const { db } = mockPg(undefined); // getExtension → null
    const { chDb, selectFrom } = mockCh([]);
    const ext = makeSnapshotReadExtension(db, chDb);

    expect(await ext.getProposalExtension('p1', 'snapshot')).toBeNull();
    expect(selectFrom).not.toHaveBeenCalled(); // no aggregation without metadata
  });
});

describe('makeSnapshotReadExtension source semantics', () => {
  const ext = () => makeSnapshotReadExtension(mockPg(undefined).db, mockCh([]).chDb);

  it('reports power-bearing votes vs relationship-only delegation, and permissive choice bounds', () => {
    expect(ext().delegationModel('snapshot')).toBe('power-bearing');
    expect(ext().delegationModel('snapshot_delegate_registry')).toBe('relationship-only');
    expect(ext().choiceBounds('snapshot')).toEqual({ min: 0, max: 127 });
  });

  it('curates the snapshot source_config down to its space', () => {
    expect(ext().curateSourceConfig?.('snapshot', { space: 'lido-snapshot.eth', junk: 1 })).toEqual(
      {
        space: 'lido-snapshot.eth',
      },
    );
  });
});
