// A resolved forum-thread link on a proposal (proposal_forum_link ⨝ forum_thread). Forum links are
// cross-source — a proposal of any source_type may carry them — so they are surfaced through this
// dedicated reader rather than the source-type-keyed SourceReadExtension resolver.
export interface ForumLinkView {
  forum_host: string;
  forum_topic_id: string;
  title: string | null;
  url: string;
  confidence: 'high' | 'medium' | 'low';
  last_activity_at: string | null; // ISO seconds
}

export interface ForumLinkReader {
  getLinksForProposal(proposalId: string): Promise<ForumLinkView[]>;
}

// DI token for the ForumLinkReader implementation. Lives in @libs/domain (not @nest/* or @sources/*)
// so apps/api may inject it while staying source-blind (eslint bans @sources/* imports under apps/api).
export const FORUM_LINK_READER = 'FORUM_LINK_READER';
