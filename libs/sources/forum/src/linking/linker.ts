import { extractForumThreadRefs, proposalTitleKey, threadTitleKey } from './matchers';
import type { LinkCandidateThread, NewForumLink } from '../persistence/forum-link-repository';

export interface LinkableProposal {
  id: string;
  title: string | null;
  description: string;
}

/**
 * Compute every deterministic link between one proposal and a set of candidate threads, applying
 * the same high/medium rules as classifyLink but hoisting the per-proposal work (parse the
 * description once, key the title once) out of the thread loop. High wins per pair — a thread the
 * description links to is never also recorded as a medium title match.
 */
export function computeProposalLinks(
  proposal: LinkableProposal,
  threads: readonly LinkCandidateThread[],
): NewForumLink[] {
  if (threads.length === 0) return [];

  const hosts = [...new Set(threads.map((t) => t.forumHost))];
  const refs = new Set(
    extractForumThreadRefs(proposal.description, hosts).map((r) => `${r.host}:${r.topicId}`),
  );
  const proposalKey = proposalTitleKey(proposal.title);

  const links: NewForumLink[] = [];
  for (const thread of threads) {
    if (refs.has(`${thread.forumHost}:${thread.forumTopicId}`)) {
      links.push({
        proposalId: proposal.id,
        forumThreadId: thread.id,
        confidence: 'high',
        linkMethod: 'description_url',
      });
      continue;
    }
    if (proposalKey !== null && threadTitleKey(thread.title) === proposalKey) {
      links.push({
        proposalId: proposal.id,
        forumThreadId: thread.id,
        confidence: 'medium',
        linkMethod: 'community_curated',
      });
    }
  }
  return links;
}
