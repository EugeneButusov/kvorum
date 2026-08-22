import { render, screen } from '@testing-library/react';

import { ForumSection } from './forum-section';
import type { ForumSynthesis, ForumSynthesisSection } from '../../lib/ai/panel';
import type { OffchainLinkView } from '../../lib/proposals/detail';

function link(overrides: Partial<OffchainLinkView> = {}): OffchainLinkView {
  return {
    platform: 'discourse',
    host: 'gov.compound.finance',
    url: 'https://gov.compound.finance/t/123',
    title: 'Raise USDC cap',
    confidence: 'high',
    lastActivityAt: null,
    ...overrides,
  };
}

const SYNTHESIS: ForumSynthesis = {
  arguments_for: [{ summary: 'Improves capital efficiency', supporting_participants: ['alice'] }],
  arguments_against: [],
  unresolved_concerns: [{ summary: 'Oracle risk', raised_by: ['bob'] }],
  notable_participants: [{ handle: 'alice', role_summary: 'delegate' }],
  sentiment: 'favorable',
  thread_health: 'constructive',
};

describe('ForumSection', () => {
  it('renders the synthesis body inside a fenced AI panel when present', () => {
    const synthesis: ForumSynthesisSection = { state: 'ok', data: SYNTHESIS, meta: {} };
    render(<ForumSection links={[link()]} synthesis={synthesis} />);

    expect(screen.getByRole('region', { name: 'AI generated content' })).toBeInTheDocument();
    expect(screen.getByText(/Improves capital efficiency/)).toBeInTheDocument();
    expect(screen.getByText(/Oracle risk/)).toBeInTheDocument();
    expect(screen.getByText(/sentiment · favorable/)).toBeInTheDocument();
  });

  it('surfaces a non-English skip as a plain note, not fenced AI output', () => {
    const synthesis: ForumSynthesisSection = { state: 'skipped', reason: 'non_english' };
    render(<ForumSection links={[link()]} synthesis={synthesis} />);

    expect(screen.getByText(/isn’t in English/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'AI generated content' })).not.toBeInTheDocument();
  });

  it('shows the coming-soon panel when a thread is linked but not yet synthesised', () => {
    render(<ForumSection links={[link()]} synthesis={{ state: 'coming-soon' }} />);

    expect(screen.getByRole('region', { name: 'AI generated content' })).toBeInTheDocument();
    expect(screen.getByText(/is not generated yet/)).toBeInTheDocument();
  });

  it('falls back to "no forum thread" only when there is no confident link and no synthesis', () => {
    render(
      <ForumSection links={[link({ confidence: 'low' })]} synthesis={{ state: 'coming-soon' }} />,
    );

    expect(screen.getByText(/No forum thread is confidently linked/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'AI generated content' })).not.toBeInTheDocument();
  });
});
