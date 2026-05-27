import { describe, expect, it } from 'vitest';
import { ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { VotesModule } from './votes.module';

describe('VotesModule', () => {
  it('exports vote/proposal read repositories', () => {
    const exported = Reflect.getMetadata('exports', VotesModule) as unknown[];
    expect(exported).toEqual([VoteReadRepository, ProposalReadRepository]);
  });
});
