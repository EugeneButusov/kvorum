import { describe, expect, it } from 'vitest';
import { projectAragonVoteCast } from './vote-projector';

describe('projectAragonVoteCast', () => {
  it('maps supports=true to primary_choice 1 (Yes) with stake as power', () => {
    expect(
      projectAragonVoteCast({
        voteId: '1',
        voter: '0x' + '1'.repeat(40),
        supports: true,
        stake: '123',
      }),
    ).toEqual({ primaryChoice: 1, votingPower: '123' });
  });

  it('maps supports=false to primary_choice 0 (No)', () => {
    expect(
      projectAragonVoteCast({
        voteId: '1',
        voter: '0x' + '1'.repeat(40),
        supports: false,
        stake: '456',
      }),
    ).toEqual({ primaryChoice: 0, votingPower: '456' });
  });
});
