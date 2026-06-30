import { describe, it, expect } from 'vitest';
import { projectSnapshotProposal } from './proposal-projector';
import type { SnapshotProposalPayload } from './types';

function payload(overrides: Partial<SnapshotProposalPayload> = {}): SnapshotProposalPayload {
  return {
    id: '0xprop',
    created: 1_700_000_000,
    title: 'A title',
    body: 'the body',
    choices: ['For', 'Against', 'Abstain'],
    type: 'single-choice',
    start: 1_700_000_100,
    end: 1_700_000_900,
    state: 'active',
    scores: [10, 5, 0],
    scores_total: 15,
    scores_state: 'pending',
    author: '0xAUTHOR',
    ipfs: 'Qm123',
    network: '1',
    flagged: false,
    strategies: [{ name: 'erc20-balance-of' }],
    space: { id: 'lido-snapshot.eth' },
    ...overrides,
  };
}

describe('projectSnapshotProposal', () => {
  it('flags spam before anything else', () => {
    expect(projectSnapshotProposal(payload({ flagged: true })).kind).toBe('flagged');
  });

  it('detects the deletion sentinel', () => {
    const result = projectSnapshotProposal({ id: '0xprop', created: 1, deleted: true });
    expect(result).toEqual({ kind: 'deleted', sourceId: '0xprop' });
  });

  it('projects a full proposal with metadata, choices, and lowercased proposer', () => {
    const result = projectSnapshotProposal(payload());
    if (result.kind !== 'derive') throw new Error('expected derive');
    expect(result.sourceId).toBe('0xprop');
    expect(result.proposerAddress).toBe('0xauthor');
    expect(result.title).toBe('A title');
    expect(result.description).toBe('the body');
    expect(result.descriptionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.choices).toEqual(['For', 'Against', 'Abstain']);
    expect(result.votingStartsAt).toEqual(new Date(1_700_000_100 * 1000));
    expect(result.votingEndsAt).toEqual(new Date(1_700_000_900 * 1000));
    expect(result.metadata).toEqual({
      space_id: 'lido-snapshot.eth',
      voting_type: 'single-choice',
      strategies: [{ name: 'erc20-balance-of' }],
      ipfs_hash: 'Qm123',
      network: '1',
      scores_state: 'pending',
      flagged: false,
    });
  });

  it('substitutes a placeholder title when missing', () => {
    const result = projectSnapshotProposal(payload({ title: null }));
    if (result.kind !== 'derive') throw new Error('expected derive');
    expect(result.title).toBe('Snapshot proposal 0xprop');
  });

  it('fills metadata/choice defaults for a minimal payload', () => {
    const result = projectSnapshotProposal({ id: '0xp', created: 1, author: '0xa' });
    if (result.kind !== 'derive') throw new Error('expected derive');
    expect(result.choices).toEqual([]);
    expect(result.votingStartsAt).toBeNull();
    expect(result.votingEndsAt).toBeNull();
    expect(result.state).toBe('active'); // no state + not final → not-yet-closed
    expect(result.metadata).toEqual({
      space_id: '',
      voting_type: null,
      strategies: null,
      ipfs_hash: null,
      network: null,
      scores_state: null,
      flagged: false,
    });
    expect(result.stateUpdatedAt).toEqual(new Date(1000));
  });

  it('tolerates a missing author and empty body', () => {
    const result = projectSnapshotProposal(payload({ author: null, body: null }));
    if (result.kind !== 'derive') throw new Error('expected derive');
    expect(result.proposerAddress).toBeNull();
    expect(result.description).toBe('');
    expect(result.descriptionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('state mapping', () => {
    it('pending → pending', () => {
      const r = projectSnapshotProposal(payload({ state: 'pending' }));
      expect(r.kind === 'derive' && r.state).toBe('pending');
    });
    it('active → active', () => {
      const r = projectSnapshotProposal(payload({ state: 'active' }));
      expect(r.kind === 'derive' && r.state).toBe('active');
    });
    it('closed but not final → active (awaiting reconcile)', () => {
      const r = projectSnapshotProposal(payload({ state: 'closed', scores_state: 'pending' }));
      expect(r.kind === 'derive' && r.state).toBe('active');
    });
    it('closed + final + participation → succeeded', () => {
      const r = projectSnapshotProposal(
        payload({ state: 'closed', scores_state: 'final', scores_total: 15 }),
      );
      expect(r.kind === 'derive' && r.state).toBe('succeeded');
    });
    it('closed + final + no votes → expired', () => {
      const r = projectSnapshotProposal(
        payload({ state: 'closed', scores_state: 'final', scores_total: 0 }),
      );
      expect(r.kind === 'derive' && r.state).toBe('expired');
    });
    it('sets state_updated_at from end (closed) and created (no end)', () => {
      const closed = projectSnapshotProposal(payload({ state: 'closed', end: 1_700_000_900 }));
      expect(closed.kind === 'derive' && closed.stateUpdatedAt).toEqual(
        new Date(1_700_000_900 * 1000),
      );
      const noEnd = projectSnapshotProposal(payload({ end: null, created: 1_700_000_000 }));
      expect(noEnd.kind === 'derive' && noEnd.stateUpdatedAt).toEqual(
        new Date(1_700_000_000 * 1000),
      );
    });
  });
});
