import { describe, expect, it } from 'vitest';
import { computeProposalLinks } from './linker';
import type { LinkCandidateThread } from '../persistence/forum-link-repository';

const LIDO = 'research.lido.fi';

function thread(id: string, topicId: string, title: string | null): LinkCandidateThread {
  return { id, forumHost: LIDO, forumTopicId: topicId, title };
}

describe('computeProposalLinks', () => {
  it('returns [] when there are no candidate threads', () => {
    expect(computeProposalLinks({ id: 'p1', title: 'T', description: 'd' }, [])).toEqual([]);
  });

  it('links high via description URL and medium via stage-tag title, across many threads', () => {
    const threads = [
      thread('t1', '100', '[ARFC] Add feed'), // medium (title match)
      thread('t2', '200', 'Unrelated'), // no match
      thread('t3', '300', 'anything'), // high (URL)
    ];
    const proposal = {
      id: 'p1',
      title: 'Add feed',
      description: `background https://${LIDO}/t/x/300`,
    };
    expect(computeProposalLinks(proposal, threads)).toEqual([
      {
        proposalId: 'p1',
        forumThreadId: 't1',
        confidence: 'medium',
        linkMethod: 'community_curated',
      },
      { proposalId: 'p1', forumThreadId: 't3', confidence: 'high', linkMethod: 'description_url' },
    ]);
  });

  it('records only high (not also medium) when both apply to the same thread', () => {
    const threads = [thread('t1', '100', '[ARFC] Add feed')];
    const proposal = { id: 'p1', title: 'Add feed', description: `https://${LIDO}/t/x/100` };
    expect(computeProposalLinks(proposal, threads)).toEqual([
      { proposalId: 'p1', forumThreadId: 't1', confidence: 'high', linkMethod: 'description_url' },
    ]);
  });

  it('does not link a null-title proposal via medium', () => {
    const threads = [thread('t1', '100', '[ARFC] Add feed')];
    expect(computeProposalLinks({ id: 'p1', title: null, description: 'x' }, threads)).toEqual([]);
  });
});
