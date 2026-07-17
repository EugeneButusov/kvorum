import { sourceFilterOptions, sourceLabel } from './source';

describe('sourceFilterOptions', () => {
  it('collapses a multi-chain source to one option', () => {
    // The sources endpoint returns one row per (source_type, chain_id): Aave's payloads controller
    // is deployed per voting chain, so it arrives repeated.
    expect(
      sourceFilterOptions([
        'aave_payloads_controller',
        'aave_payloads_controller',
        'aave_payloads_controller',
        'aave_governance_v3',
      ]),
    ).toEqual(['aave_governance_v3', 'aave_payloads_controller']);
  });

  it('drops the reconciler plumbing, which no proposal ever carries', () => {
    expect(
      sourceFilterOptions([
        'aave_governance_v3',
        'aave_governance_v3_reconcile',
        'aave_governor_v2_reconcile',
        'aave_payloads_controller_reconcile',
      ]),
    ).toEqual(['aave_governance_v3']);
  });

  it('reduces a real Aave source list to the handful worth offering', () => {
    // Shape observed on app.kvorum.watch/daos/aave/proposals, which rendered ~40 chips.
    const raw = [
      'aave_governance_v3',
      'aave_governance_v3_reconcile',
      'aave_governor_v2',
      'aave_governor_v2_reconcile',
      ...Array.from({ length: 20 }, () => 'aave_payloads_controller'),
      ...Array.from({ length: 16 }, () => 'aave_payloads_controller_reconcile'),
      'aave_token',
      ...Array.from({ length: 3 }, () => 'aave_voting_machine'),
      'discourse_forum',
      'snapshot',
    ];
    expect(sourceFilterOptions(raw)).toEqual([
      'aave_governance_v3',
      'aave_governor_v2',
      'aave_payloads_controller',
      'aave_token',
      'aave_voting_machine',
      'discourse_forum',
      'snapshot',
    ]);
  });

  it('is stable regardless of the order rows arrive in', () => {
    expect(sourceFilterOptions(['snapshot', 'aave_token'])).toEqual(
      sourceFilterOptions(['aave_token', 'snapshot']),
    );
  });

  it('has nothing to offer for an empty list', () => {
    expect(sourceFilterOptions([])).toEqual([]);
  });
});

describe('sourceLabel', () => {
  it('reads a source_type as prose', () => {
    expect(sourceLabel('aragon_voting')).toBe('Aragon voting');
  });
});
