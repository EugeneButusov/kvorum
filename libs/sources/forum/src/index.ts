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
export type {
  DiscourseCategory,
  DiscoursePost,
  DiscourseThread,
  DiscourseTopicSummary,
} from './client/types';

// ── Content pipeline (ADR-034) ──────────────────────────────────────────────────────
export { createTurndownService } from './content/turndown-config';
export { CONTENT_PIPELINE_VERSION, normalizePost, renderThread } from './content/content-pipeline';
export type { RenderedThread } from './content/content-pipeline';

// ── Source plugin (off-chain crawl) ─────────────────────────────────────────────────
export {
  createForumPlugin,
  SUPPORTED_CHAIN_IDS,
  DEFAULT_FORUM_POLL_INTERVAL_MS,
  type ForumPluginDeps,
} from './plugin/plugin';
export { ForumConfigSchema, parseForumConfig, type ForumConfig } from './plugin/config';
export {
  makeForumPollListener,
  DEFAULT_MAX_THREADS_PER_TICK,
  DEFAULT_RECONCILE_INTERVAL_MS,
  type ForumPollListenerDeps,
} from './ingestion/poll-listener';
export { makeForumOffChainArchiveWriter } from './ingestion/archive-writer';
export { contentHash } from './ingestion/content-hash';
export type { ForumCursor, ForumThreadPayload } from './ingestion/types';

// ── Persistence + derivers ──────────────────────────────────────────────────────────
export {
  ForumThreadRepository,
  type ForumThreadUpsert,
} from './persistence/forum-thread-repository';
export {
  ForumArchivePayloadRepository,
  type ForumArchivePayload,
} from './persistence/archive-payload-repository';
export {
  ForumThreadProjectionApplier,
  type ForumThreadProjectionApplierDeps,
} from './domain/thread-projection-applier';
export { ForumThreadActorAddressDeriver } from './domain/actor-address-deriver';

// ── Proposal↔thread linking (SPEC §3.7) ─────────────────────────────────────────────
export {
  classifyLink,
  extractForumThreadRefs,
  normalizeTitle,
  stripStageTag,
  proposalTitleKey,
  threadTitleKey,
  type ForumThreadRef,
  type LinkClassification,
  type LinkConfidence,
  type LinkMethod,
} from './linking/matchers';
export { computeProposalLinks, type LinkableProposal } from './linking/linker';
export {
  ForumLinkRepository,
  type NewForumLink,
  type UnscannedProposal,
  type LinkCandidateThread,
} from './persistence/forum-link-repository';

// ── Read extension ──────────────────────────────────────────────────────────────────
export { makeForumReadExtension } from './api/forum-read-extension';

// ── Metrics ─────────────────────────────────────────────────────────────────────
export { forumMetrics } from './metrics';
