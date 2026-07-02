import { describe, expect, it, vi } from 'vitest';
import { SnapshotProposalExtensionReadRepository } from './snapshot-proposal-extension-read-repository';

function mockPg(row: Record<string, unknown> | undefined) {
  const builder: Record<string, unknown> = {};
  for (const m of ['selectAll', 'where']) builder[m] = vi.fn(() => builder);
  builder['executeTakeFirst'] = vi.fn().mockResolvedValue(row);
  const selectFrom = vi.fn(() => builder);
  return { db: { selectFrom } as never, selectFrom };
}

describe('SnapshotProposalExtensionReadRepository', () => {
  it('maps snapshot_proposal_metadata into the snapshot metadata view', async () => {
    const { db, selectFrom } = mockPg({
      proposal_id: 'p1',
      space_id: 'lido-snapshot.eth',
      voting_type: 'weighted',
      strategies: [{ name: 'erc20-balance-of' }],
      ipfs_hash: 'Qm123',
      network: '1',
      scores_state: 'final',
      flagged: false,
    });
    const repo = new SnapshotProposalExtensionReadRepository(db);

    const ext = await repo.getExtension('p1');
    expect(selectFrom).toHaveBeenCalledWith('snapshot_proposal_metadata');
    expect(ext).toEqual({
      voting: null,
      payloads: [],
      metadata: {
        kind: 'snapshot',
        space_id: 'lido-snapshot.eth',
        voting_type: 'weighted',
        strategies: [{ name: 'erc20-balance-of' }],
        ipfs_hash: 'Qm123',
        network: '1',
        scores_state: 'final',
        flagged: false,
      },
    });
  });

  it('returns null when the metadata row is missing', async () => {
    const { db } = mockPg(undefined);
    const repo = new SnapshotProposalExtensionReadRepository(db);
    await expect(repo.getExtension('missing')).resolves.toBeNull();
  });
});
