import { render, screen } from '@testing-library/react';

import { SummaryPanel } from './summary-panel';
import type { ProposalAiSummary } from '../../lib/ai/panel';

function summary(overrides: Partial<ProposalAiSummary> = {}): ProposalAiSummary {
  return {
    tldr: 'Raises the USDC supply cap on Base.',
    proposal_type: 'parameter_change',
    proposal_type_confidence: 'high',
    affected_contracts: ['0xabc0000000000000000000000000000000000001'],
    key_changes: [{ description: 'Supply cap 50M → 100M', significance: 'high' }],
    funding_amount_usd: '0',
    notable_concerns: ['Cap doubles in one step'],
    _meta: {
      ai_generated: true,
      model: 'claude-sonnet',
      prompt_version: 'v3',
      input_hash: 'sha256:abc',
      generated_at: '2026-08-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('SummaryPanel', () => {
  it('renders the TL;DR and structured facts, fenced as AI content', () => {
    render(<SummaryPanel summary={summary()} />);

    expect(screen.getByRole('region', { name: 'AI generated content' })).toBeInTheDocument();
    expect(screen.getByText(/Raises the USDC supply cap/)).toBeInTheDocument();
    expect(screen.getByText(/Supply cap 50M → 100M/)).toBeInTheDocument();
    expect(screen.getByText(/Cap doubles in one step/)).toBeInTheDocument();
    expect(screen.getByText('parameter change')).toBeInTheDocument();
  });

  it('shows a fenced coming-soon panel (no fabricated prose) when not yet generated', () => {
    render(<SummaryPanel summary={null} />);

    expect(screen.getByRole('region', { name: 'AI generated content' })).toBeInTheDocument();
    expect(screen.getByText(/is not generated yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Read the description/ })).toHaveAttribute(
      'href',
      '#description',
    );
  });
});
