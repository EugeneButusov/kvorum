import { buildBio, toActorVote, toAuthored, toFootprint, type DaoFootprint } from './actor';
import type { components } from '@/lib/api/schema';

const E18 = 10n ** 18n;

function footprint(over: Partial<DaoFootprint> = {}): DaoFootprint {
  return {
    slug: 'compound',
    votingPower: 100,
    votesCast: 5,
    proposalsProposed: 0,
    majorityAlignmentPct: 0.8,
    ...over,
  };
}

describe('buildBio', () => {
  it('summarizes a single-DAO actor', () => {
    expect(buildBio([footprint({ slug: 'compound', votesCast: 5 })])).toBe(
      'Active in 1 DAO (compound) — 5 votes cast.',
    );
  });

  it('lists multiple DAOs and pluralizes', () => {
    expect(
      buildBio([
        footprint({ slug: 'compound', votesCast: 7 }),
        footprint({ slug: 'aave', votesCast: 5 }),
      ]),
    ).toBe('Active in 2 DAOs (compound and aave) — 12 votes cast.');
  });

  it('mentions authored proposals when present', () => {
    expect(buildBio([footprint({ votesCast: 1, proposalsProposed: 3 })])).toContain(
      'authored 3 proposals',
    );
  });

  it('handles an actor with no footprint', () => {
    expect(buildBio([])).toBe('No governance activity recorded yet.');
  });
});

describe('toFootprint', () => {
  it('scales voting power and coerces the (0..1) alignment', () => {
    const f = toFootprint({
      dao_slug: 'lido',
      votes_cast: 12,
      proposals_proposed: 2,
      current_voting_power: (50n * E18).toString(),
      last_active_at: null,
      alignment_with_majority_pct: 0.75 as never,
    } as components['schemas']['CrossDaoSummaryDto']);
    expect(f).toEqual({
      slug: 'lido',
      votingPower: 50,
      votesCast: 12,
      proposalsProposed: 2,
      majorityAlignmentPct: 0.75,
    });
  });
});

describe('toActorVote / toAuthored', () => {
  it('maps an actor vote and builds the proposal href', () => {
    const v = toActorVote({
      vote_id: 'v1',
      voting_chain_id: '1',
      proposal: {
        proposal_id: '42',
        source_type: 'aragon_voting',
        dao_slug: 'lido',
        title: 'Fund it',
        state: 'active',
        created_at: '',
        voting_ends_at: null,
        _meta: {} as never,
      },
      primary_choice: 1 as never,
      voting_power_reported: '0',
      cast_at: '2026-07-01T00:00:00Z' as never,
      _meta: {} as never,
    });
    expect(v.href).toBe('/daos/lido/proposals/aragon_voting/42');
    expect(v.primaryChoice).toBe(1);
    expect(v.title).toBe('Fund it');
  });

  it('maps an authored proposal', () => {
    const p = toAuthored({
      proposal_id: '7',
      source_type: 'snapshot',
      dao_slug: 'lido',
      title: null,
      state: 'executed',
      voting_starts_at: null,
      voting_ends_at: null,
      created_at: '',
      _meta: {} as never,
    });
    expect(p.href).toBe('/daos/lido/proposals/snapshot/7');
    expect(p.title).toBeNull();
  });
});
