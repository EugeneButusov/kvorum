import { render, screen } from '@testing-library/react';

import { MismatchSection } from './mismatch-section';
import type { ProposalMismatch } from '../../lib/ai/panel';

function analysis(overrides: Partial<ProposalMismatch> = {}): ProposalMismatch {
  return {
    overall_assessment: 'material_discrepancy',
    confidence: 'high',
    description_actions: [],
    calldata_actions: [],
    discrepancies: [
      {
        type: 'value_mismatch',
        description: 'Transfers 2x the stated amount.',
        severity: 'high',
        description_excerpt: 'transfer 100 USDC',
        related_action_indices: [0],
      },
    ],
    reasoning: 'The calldata moves twice what the description claims.',
    _meta: {
      ai_generated: true,
      model: 'claude-sonnet',
      prompt_version: 'v2',
      input_hash: 'sha256:def',
      generated_at: '2026-08-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('MismatchSection', () => {
  it('renders the assessment, reasoning and discrepancies when analysed', () => {
    render(<MismatchSection result={{ state: 'ok', data: analysis() }} />);

    expect(screen.getByText('Material discrepancy')).toBeInTheDocument();
    expect(screen.getByText(/moves twice what the description claims/)).toBeInTheDocument();
    expect(screen.getByText(/Transfers 2x the stated amount/)).toBeInTheDocument();
  });

  it('shows a fenced coming-soon panel when nothing has been analysed', () => {
    render(<MismatchSection result={{ state: 'coming-soon' }} />);

    expect(screen.getByRole('region', { name: 'AI generated content' })).toBeInTheDocument();
    expect(screen.getByText(/is not generated yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review the decoded actions/ })).toHaveAttribute(
      'href',
      '#actions',
    );
  });

  it('fabricates nothing in the failed state and points at the raw actions', () => {
    render(<MismatchSection result={{ state: 'failed' }} />);

    expect(screen.getByRole('region', { name: 'AI generated content' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review the decoded actions/ })).toBeInTheDocument();
  });
});
