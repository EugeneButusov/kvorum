import { render, screen } from '@testing-library/react';

import { ProposalHeader } from './proposal-header';
import type { ProposalDetailView } from '@/lib/proposals/detail';

function detail(over: Partial<ProposalDetailView> = {}): ProposalDetailView {
  return {
    daoSlug: 'lido',
    sourceType: 'aragon_voting',
    sourceId: '42',
    title: 'Fund the treasury',
    state: 'active',
    binding: true,
    votingStartsAt: null,
    votingEndsAt: null,
    proposer: { address: '0xProposer000000000000000000000000000000aa', displayName: 'alice.eth' },
    description: '',
    originChainId: '1',
    choices: [],
    actions: [],
    payloads: null,
    voting: null,
    metadata: null,
    offchainLinks: [],
    lastUpdatedAt: '2026-07-01T00:00:00Z',
    confirmed: true,
    ...over,
  };
}

describe('ProposalHeader', () => {
  it('makes the source explicit (§6.17) and shows title + state + proposer', () => {
    render(<ProposalHeader detail={detail()} />);
    expect(screen.getByRole('heading', { name: 'Fund the treasury' })).toBeInTheDocument();
    expect(screen.getByText('Aragon voting')).toBeInTheDocument();
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('alice.eth')).toBeInTheDocument();
  });

  it('flags non-binding (signaling) proposals', () => {
    render(<ProposalHeader detail={detail({ binding: false })} />);
    expect(screen.getByText(/non-binding/)).toBeInTheDocument();
  });

  it('links out to Snapshot when the metadata carries a space id', () => {
    const view = detail({
      sourceType: 'snapshot',
      sourceId: '0xdeadbeef',
      metadata: { kind: 'snapshot', space_id: 'lido-snapshot.eth', flagged: false } as never,
    });
    render(<ProposalHeader detail={view} />);
    const link = screen.getByRole('link', { name: /View on Snapshot/ });
    expect(link).toHaveAttribute(
      'href',
      'https://snapshot.org/#/lido-snapshot.eth/proposal/0xdeadbeef',
    );
  });

  it('omits the source link when no correct deep link can be built', () => {
    render(<ProposalHeader detail={detail()} />);
    expect(screen.queryByRole('link', { name: /View on/ })).not.toBeInTheDocument();
  });
});
