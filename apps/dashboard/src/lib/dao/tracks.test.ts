import { resolveTracks } from './tracks';

// Exactly what dao_source carries for Aave today: three governance tracks and seven pieces of
// ingestion plumbing. This list is the whole reason the module exists.
const AAVE_SOURCE_TYPES = [
  'aave_governance_v3',
  'aave_governance_v3_reconcile',
  'aave_governor_v2',
  'aave_governor_v2_reconcile',
  'aave_payloads_controller',
  'aave_payloads_controller_reconcile',
  'aave_token',
  'aave_voting_machine',
  'discourse_forum',
  'snapshot',
];

describe('resolveTracks', () => {
  it("reduces Aave's ten source types to its three real tracks, in registry order", () => {
    expect(resolveTracks(AAVE_SOURCE_TYPES).map((t) => t.label)).toEqual([
      'Governance v3',
      'Governor v2 (legacy)',
      'Snapshot',
    ]);
  });

  it('keeps every Lido track and orders binding votes before signalling (§6.17)', () => {
    const tracks = resolveTracks([
      'snapshot',
      'easy_track',
      'aragon_voting',
      'dual_governance',
      'aragon_voting_reconcile',
      'aragon_proposal_metadata',
    ]);
    expect(tracks.map((t) => t.label)).toEqual([
      'Aragon voting',
      'Dual governance',
      'Easy Track',
      'Snapshot',
    ]);
    expect(tracks.find((t) => t.sourceType === 'dual_governance')?.description).toMatch(/stETH/);
  });

  it('no longer describes Snapshot in Lido-specific terms', () => {
    const snapshot = resolveTracks(['snapshot'])[0];
    expect(snapshot?.description).not.toMatch(/lido|LDO/i);
  });

  it('drops reconcilers, metadata enrichers and token indexers by suffix', () => {
    expect(
      resolveTracks([
        'compound_governor_bravo_reconcile',
        'aragon_proposal_metadata',
        'compound_proposal_meta',
        'compound_comp_token',
      ]),
    ).toEqual([]);
  });

  it('drops track machinery that shares an electorate or holds no vote', () => {
    expect(
      resolveTracks(['aave_voting_machine', 'aave_payloads_controller', 'discourse_forum']),
    ).toEqual([]);
  });

  it('keeps an unrecognised source type, undescribed and after the known ones', () => {
    expect(resolveTracks(['mystery_governor', 'snapshot'])).toEqual([
      { sourceType: 'snapshot', label: 'Snapshot', description: expect.any(String) },
      { sourceType: 'mystery_governor', label: 'Mystery governor', description: null },
    ]);
  });

  it('sorts multiple unrecognised types alphabetically by label', () => {
    expect(resolveTracks(['zebra_governor', 'alpaca_governor']).map((t) => t.label)).toEqual([
      'Alpaca governor',
      'Zebra governor',
    ]);
  });

  it('dedupes repeated source types', () => {
    expect(resolveTracks(['snapshot', 'snapshot']).map((t) => t.sourceType)).toEqual(['snapshot']);
  });

  it('returns nothing for a DAO whose sources are all infrastructure', () => {
    expect(resolveTracks(['aave_token', 'discourse_forum'])).toEqual([]);
  });
});
