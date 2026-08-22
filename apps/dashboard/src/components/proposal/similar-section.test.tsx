import { render, screen } from '@testing-library/react';

import { SimilarSection } from './similar-section';
import type { SimilarProposalItem } from '../../lib/ai/panel';

function item(overrides: Partial<SimilarProposalItem> = {}): SimilarProposalItem {
  return {
    dao_slug: 'aave',
    dao_name: 'Aave',
    source_type: 'aave_governance_v3',
    source_id: '42',
    title: 'Raise the USDC supply cap',
    state: 'executed',
    created_at: '2026-06-01T00:00:00.000Z',
    voting_starts_at: null,
    voting_ends_at: null,
    similarity: 0.873,
    ...overrides,
  };
}

describe('SimilarSection', () => {
  it('renders a ranked list with links and similarity scores', () => {
    render(<SimilarSection items={[item()]} />);

    expect(screen.getByText('Raise the USDC supply cap')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/daos/aave/proposals/aave_governance_v3/42',
    );
  });

  it('states plainly when there are no neighbours (degrades to empty, never errors)', () => {
    render(<SimilarSection items={[]} />);

    expect(screen.getByText(/No semantically similar proposals/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
