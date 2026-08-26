import { render, screen, within } from '@testing-library/react';

import { DaoHeader } from './dao-header';

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

function renderHeader(sourceTypes: string[]) {
  return render(
    <DaoHeader
      name="Aave"
      description="Aave is a decentralized non-custodial liquidity protocol."
      tokenAddress="0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9"
      websiteUrl="https://aave.com"
      forumUrl="https://governance.aave.com"
      sourceTypes={sourceTypes}
    />,
  );
}

describe('DaoHeader', () => {
  it('names only the real governance tracks, not the ingestion plumbing', () => {
    renderHeader(AAVE_SOURCE_TYPES);
    const tracks = screen.getByRole('list', { name: 'Tracks' });
    expect(within(tracks).getAllByRole('listitem')).toHaveLength(3);
    expect(tracks).toHaveTextContent('Governance v3');
    expect(tracks).toHaveTextContent('Governor v2 (legacy)');
    expect(tracks).toHaveTextContent('Snapshot');
    expect(tracks).not.toHaveTextContent(/reconcile/i);
    expect(tracks).not.toHaveTextContent(/voting machine/i);
  });

  it('explains a recognised track on hover and stays silent on an unrecognised one', () => {
    renderHeader(['aave_governance_v3', 'mystery_governor']);
    expect(screen.getByText('Governance v3').getAttribute('title')).toMatch(/AAVE/);
    expect(screen.getByText('Mystery governor')).not.toHaveAttribute('title');
  });

  it('still names a single-track DAO', () => {
    renderHeader(['compound_governor_bravo', 'compound_comp_token']);
    expect(screen.getByRole('list', { name: 'Tracks' })).toHaveTextContent('Governor Bravo');
  });

  it('omits the tracks row when there is nothing to name, keeping token and links', () => {
    renderHeader([]);
    expect(screen.queryByRole('list', { name: 'Tracks' })).not.toBeInTheDocument();
    expect(screen.getByText('0x7fc6…dae9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Website/ })).toBeInTheDocument();
  });
});
