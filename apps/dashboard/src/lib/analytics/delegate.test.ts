import {
  parseProposalLink,
  participation,
  powerTrajectory,
  toAlignmentView,
  type DelegateVote,
} from './delegate';
import type { components } from '@/lib/api/schema';

function vote(over: Partial<DelegateVote>): DelegateVote {
  return {
    voteId: 'v',
    key: 'snapshot:1',
    sourceType: 'snapshot',
    title: 'A proposal',
    state: 'executed',
    choice: 0,
    power: 100,
    castAt: '2026-05-01T00:00:00Z',
    href: '/daos/lido/proposals/snapshot/1',
    ...over,
  };
}

describe('parseProposalLink', () => {
  it('extracts source_type + source_id from the API link', () => {
    expect(parseProposalLink('/v1/daos/lido/proposals/snapshot/0xabc')).toEqual({
      sourceType: 'snapshot',
      sourceId: '0xabc',
    });
  });
  it('returns null for an unparseable link', () => {
    expect(parseProposalLink('/v1/actors/0x1')).toBeNull();
  });
});

describe('participation', () => {
  it('marks voted vs missed proposals and computes the rate', () => {
    const proposals = [
      { sourceType: 'snapshot', sourceId: '1', title: 'A' },
      { sourceType: 'snapshot', sourceId: '2', title: 'B' },
      { sourceType: 'snapshot', sourceId: '3', title: null },
    ];
    const votes = [
      vote({ key: 'snapshot:1', choice: 1 }),
      vote({ key: 'snapshot:3', choice: null }),
    ];
    const { cells, rate } = participation(proposals, votes);
    expect(cells.map((c) => c.voted)).toEqual([true, false, true]);
    expect(cells[0]!.choiceIndex).toBe(1);
    expect(cells[2]!.title).toBe('#3'); // null title → id fallback
    expect(rate).toBe(67); // 2 of 3
  });
});

describe('powerTrajectory', () => {
  it('orders votes oldest→newest and reads out the reported power', () => {
    const traj = powerTrajectory([
      vote({ castAt: '2026-07-01T00:00:00Z', power: 300 }),
      vote({ castAt: '2026-01-01T00:00:00Z', power: 100 }),
      vote({ castAt: null, power: 999 }), // undated votes are dropped
    ]);
    expect(traj.values).toEqual([100, 300]);
    expect(traj.buckets).toEqual(['2026-01', '2026-07']);
  });
});

describe('toAlignmentView', () => {
  it('scales alignment scores to percent and labels peers', () => {
    const peers = [
      {
        actor_id: 'x',
        address: '0xaaaa000000000000000000000000000000000000',
        display_name: 'Gauntlet',
        vote_count: 10,
        shared_proposals: 8,
        alignment_score: 0.75,
      },
      {
        actor_id: 'y',
        address: '0xbbbb000000000000000000000000000000000000',
        display_name: null,
        vote_count: 5,
        shared_proposals: 4,
        alignment_score: 0.5,
      },
    ] as unknown as components['schemas']['DelegateAlignmentPeerDto'][];
    const view = toAlignmentView(peers);
    expect(view.rowLabels).toEqual(['Gauntlet', '0xbbbb…0000']);
    expect(view.cells).toEqual([[75], [50]]);
  });
});
