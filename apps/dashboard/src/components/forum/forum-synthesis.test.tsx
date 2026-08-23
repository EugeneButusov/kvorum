import { render, screen } from '@testing-library/react';

import { ForumSynthesis } from './forum-synthesis';
import type { ForumSynthesis as ForumSynthesisData } from '@/lib/ai/panel';

const DATA: ForumSynthesisData = {
  arguments_for: [{ summary: 'Higher limit unlocks demand', supporting_participants: ['alice'] }],
  arguments_against: [{ summary: 'Concentration risk', supporting_participants: ['bob'] }],
  unresolved_concerns: [{ summary: 'Node operator capacity', raised_by: ['carol'] }],
  notable_participants: [{ handle: 'alice', role_summary: 'delegate' }],
  sentiment: 'mixed',
  thread_health: 'constructive',
};

const HREF = 'https://research.lido.fi/t/4821';

describe('ForumSynthesis', () => {
  it('renders the synthesis in a fenced AI panel with a source link', () => {
    render(<ForumSynthesis synthesis={{ state: 'ok', data: DATA, meta: {} }} sourceHref={HREF} />);

    expect(screen.getByRole('region', { name: 'AI generated content' })).toBeInTheDocument();
    expect(screen.getByText(/Higher limit unlocks demand/)).toBeInTheDocument();
    expect(screen.getByText(/Concentration risk/)).toBeInTheDocument();
    expect(screen.getByText(/Node operator capacity/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Read the thread/ })).toHaveAttribute('href', HREF);
  });

  it('surfaces a non-English skip as a plain note, not fenced AI output', () => {
    render(
      <ForumSynthesis synthesis={{ state: 'skipped', reason: 'non_english' }} sourceHref={HREF} />,
    );

    expect(screen.getByText(/isn’t in English/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'AI generated content' })).not.toBeInTheDocument();
  });

  it('shows a fenced coming-soon panel when the thread is not yet synthesised', () => {
    render(<ForumSynthesis synthesis={{ state: 'coming-soon' }} sourceHref={HREF} />);

    expect(screen.getByRole('region', { name: 'AI generated content' })).toBeInTheDocument();
    expect(screen.getByText(/is not generated yet/)).toBeInTheDocument();
  });
});
