import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { PgDatabase } from '@libs/db';

// ── Forum Thread ──────────────────────────────────────────────────────────────

export interface ForumThreadTable {
  id: Generated<string>;
  dao_id: string;
  forum_host: string;
  // pg driver returns bigint as string
  forum_topic_id: string;
  raw_content: string | null;
  content_pipeline_version: string | null;
  post_count: number | null;
  last_activity_at: Date | null;
}

export type ForumThread = Selectable<ForumThreadTable>;
export type NewForumThread = Insertable<ForumThreadTable>;
export type ForumThreadUpdate = Updateable<ForumThreadTable>;

// ── Proposal Forum Link ───────────────────────────────────────────────────────

// KNOWN-005: low/inferred confidence values deferred to AE.
export type ProposalForumLinkConfidence = 'high' | 'medium';

export interface ProposalForumLinkTable {
  id: Generated<string>;
  proposal_id: string;
  forum_thread_id: string;
  confidence: ProposalForumLinkConfidence;
  link_method: string;
}

export type ProposalForumLink = Selectable<ProposalForumLinkTable>;
export type NewProposalForumLink = Insertable<ProposalForumLinkTable>;
export type ProposalForumLinkUpdate = Updateable<ProposalForumLinkTable>;

// ── Declaration merging ───────────────────────────────────────────────────────

declare module '@libs/db' {
  interface PgDatabase {
    forum_thread: ForumThreadTable;
    proposal_forum_link: ProposalForumLinkTable;
  }
}

type _PgCheck = PgDatabase['forum_thread'];
