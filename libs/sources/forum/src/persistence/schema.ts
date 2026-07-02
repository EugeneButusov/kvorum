import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { ClickHouseDatabase, PgDatabase } from '@libs/db';

// ── Forum Thread ──────────────────────────────────────────────────────────────

export interface ForumThreadTable {
  id: Generated<string>;
  dao_id: string;
  forum_host: string;
  // pg driver returns bigint as string
  forum_topic_id: string;
  title: string | null;
  raw_content: string | null;
  content_pipeline_version: string | null;
  post_count: number | null;
  last_activity_at: Date | null;
}

export type ForumThread = Selectable<ForumThreadTable>;
export type NewForumThread = Insertable<ForumThreadTable>;
export type ForumThreadUpdate = Updateable<ForumThreadTable>;

// ── Proposal Forum Link ───────────────────────────────────────────────────────

// 'low' is wired for the M5 embedding-based path (KNOWN-005); the deterministic linker only writes
// 'high' (description_url) and 'medium' (community_curated).
export type ProposalForumLinkConfidence = 'high' | 'medium' | 'low';

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

// ── CH archive table ──────────────────────────────────────────────────────────

export interface ArchiveEventDiscourseForumTable {
  dao_source_id: string;
  external_id: string;
  // Int32 mirrors PG archive_event.version (signed int32).
  version: number;
  content_hash: string;
  payload: string;
}

export type ArchiveEventDiscourseForum = ArchiveEventDiscourseForumTable;
export type NewArchiveEventDiscourseForum = ArchiveEventDiscourseForumTable;

// ── Declaration merging ───────────────────────────────────────────────────────

declare module '@libs/db' {
  interface PgDatabase {
    forum_thread: ForumThreadTable;
    proposal_forum_link: ProposalForumLinkTable;
  }

  interface ClickHouseDatabase {
    archive_event_discourse_forum: ArchiveEventDiscourseForumTable;
  }
}

type _PgCheck = PgDatabase['forum_thread'];
type _ChCheck = ClickHouseDatabase['archive_event_discourse_forum'];
