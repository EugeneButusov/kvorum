import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VotersTable } from './voters-table';
import type { VoteView } from '@/lib/proposals/detail';

const E18 = 1_000_000_000_000_000_000n;

const CHOICES = [
  { index: 0, value: 'For' },
  { index: 1, value: 'Against' },
];

function vote(name: string, power: bigint, choice: number): VoteView {
  return {
    voteId: `v-${name}`,
    votingChainId: '1',
    voter: { address: `0x${name.padEnd(40, '0')}`, displayName: name },
    votingPowerReported: power.toString(),
    votingPowerVerified: true,
    primaryChoice: choice,
    castAt: '2026-07-01T00:00:00Z',
    reason: null,
  };
}

const VOTES = [
  vote('small', 10n * E18, 1),
  vote('whale', 500n * E18, 0),
  vote('mid', 100n * E18, 0),
];

describe('VotersTable', () => {
  it('defaults to voting-power descending', () => {
    render(<VotersTable votes={VOTES} choices={CHOICES} />);
    const rows = screen.getAllByRole('row').slice(1); // drop header
    expect(within(rows[0]!).getByText('whale')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('small')).toBeInTheDocument();
  });

  it('filters by choice', async () => {
    const user = userEvent.setup();
    render(<VotersTable votes={VOTES} choices={CHOICES} />);
    expect(screen.getAllByRole('row')).toHaveLength(4); // header + 3

    await user.click(screen.getByRole('button', { name: 'Against' }));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText('small')).toBeInTheDocument();
  });

  it('shows the count summary', () => {
    render(<VotersTable votes={VOTES} choices={CHOICES} />);
    expect(screen.getByText('1–3 of 3')).toBeInTheDocument();
  });

  it('renders an empty state with no votes', () => {
    render(<VotersTable votes={[]} choices={CHOICES} />);
    expect(screen.getByText(/No votes recorded/)).toBeInTheDocument();
  });
});
