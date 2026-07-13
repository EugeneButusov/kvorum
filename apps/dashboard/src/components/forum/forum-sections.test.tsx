import { render, screen } from '@testing-library/react';

import { ForumHeader } from './forum-header';
import { RawThread } from './raw-thread';
import type { ForumThreadView } from '@/lib/forum/thread';

function thread(over: Partial<ForumThreadView> = {}): ForumThreadView {
  return {
    externalId: '4821',
    host: 'research.lido.fi',
    sourceUrl: 'https://research.lido.fi/t/4821',
    title: 'Increase staking limit',
    rawContent: '# Heading\n\nSome **body** text.',
    postCount: 12,
    lastActivityAt: '2026-07-01T00:00:00Z',
    linkedProposals: [
      {
        sourceType: 'aragon_voting',
        sourceId: '42',
        title: 'Binding vote',
        confidence: 'high',
        href: '/daos/lido/proposals/aragon_voting/42',
      },
    ],
    ...over,
  };
}

describe('ForumHeader', () => {
  it('renders the title, source link, post count, and linked proposal with confidence', () => {
    render(<ForumHeader thread={thread()} />);
    expect(screen.getByRole('heading', { name: 'Increase staking limit' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /research.lido.fi/ })).toHaveAttribute(
      'href',
      'https://research.lido.fi/t/4821',
    );
    expect(screen.getByText('12 posts')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Binding vote' })).toHaveAttribute(
      'href',
      '/daos/lido/proposals/aragon_voting/42',
    );
  });

  it('falls back to an id-based title', () => {
    render(<ForumHeader thread={thread({ title: null })} />);
    expect(screen.getByRole('heading', { name: 'Forum thread #4821' })).toBeInTheDocument();
  });
});

describe('RawThread', () => {
  it('renders the thread content as markdown', () => {
    render(<RawThread content={thread().rawContent} />);
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('shows an empty state when the content is absent', () => {
    render(<RawThread content={null} />);
    expect(screen.getByText(/hasn’t been ingested/)).toBeInTheDocument();
  });
});
