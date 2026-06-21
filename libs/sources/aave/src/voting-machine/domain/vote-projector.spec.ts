import { describe, expect, it } from 'vitest';
import { projectAaveVote } from './vote-projector';

describe('projectAaveVote', () => {
  it('maps support=true to For and preserves voting power', () => {
    expect(
      projectAaveVote({
        proposalId: '42',
        voter: '0x' + 'ab'.repeat(20),
        support: true,
        votingPower: '123',
      }),
    ).toEqual({
      primaryChoice: 1,
      votingPower: '123',
      seq: '0',
    });
  });

  it('maps support=false to Against', () => {
    expect(
      projectAaveVote({
        proposalId: '42',
        voter: '0x' + 'ab'.repeat(20),
        support: false,
        votingPower: '456',
      }),
    ).toEqual({
      primaryChoice: 0,
      votingPower: '456',
      seq: '0',
    });
  });
});
