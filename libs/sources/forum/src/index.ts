export type {
  ForumThread,
  ForumThreadTable,
  ForumThreadUpdate,
  NewForumThread,
  ProposalForumLink,
  ProposalForumLinkConfidence,
  ProposalForumLinkTable,
  ProposalForumLinkUpdate,
  NewProposalForumLink,
} from './persistence/schema';

// ── Discourse client ──────────────────────────────────────────────────────────────
export {
  DiscourseClient,
  NonRetriableDiscourseError,
  DEFAULT_USER_AGENT,
  POST_IDS_CHUNK_SIZE,
} from './client/client';
export type { DiscourseClientOptions } from './client/client';
export { RatePacer } from './client/rate-pacer';
export type { RatePacerOptions } from './client/rate-pacer';
export type { DiscoursePost, DiscourseThread, DiscourseTopicSummary } from './client/types';

// ── Content pipeline (ADR-034) ──────────────────────────────────────────────────────
export { createTurndownService } from './content/turndown-config';
export { CONTENT_PIPELINE_VERSION, normalizePost, renderThread } from './content/content-pipeline';
export type { RenderedThread } from './content/content-pipeline';

// ── Metrics ─────────────────────────────────────────────────────────────────────
export { forumMetrics } from './metrics';
