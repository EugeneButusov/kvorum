import type { DiscoursePost } from '../client/types';

/** The archived raw slice for one crawled thread (ADR-071 mutable-latest payload). Holds the full
 *  source needed to (re-)derive `forum_thread`: metadata + every post's `cooked` HTML. The turndown
 *  render happens in the deriver, not here, so a pipeline bump re-derives without re-crawling. */
export interface ForumThreadPayload {
  host: string;
  topicId: number;
  title: string;
  postCount: number;
  createdAt: string;
  lastActivityAt: string | null;
  posts: DiscoursePost[];
}

/** A category resolved from its configured slug to its numeric Discourse id. */
export interface ResolvedCategory {
  slug: string;
  id: number;
}

/** A topic discovered during enumeration that still needs a full-thread fetch. */
export interface PendingTopic {
  topicId: number;
  lastActivityAt: string | null;
}

/**
 * Forward-progress state for one forum host, persisted between poll ticks. A tick does EITHER a
 * bounded thread-drain (when `pending` is non-empty) OR one category-page enumeration, keeping each
 * tick well under the poll deadline. `highWater` skips unchanged topics on incremental sweeps;
 * `reconciling` sweeps ignore it to catch silent edits (deletion detection is deferred, KNOWN-029).
 */
export interface ForumCursor {
  /** Configured slugs resolved to {slug,id}; null until the first tick resolves /categories.json. */
  categories: ResolvedCategory[] | null;
  /** Index into `categories` currently being enumerated. */
  categoryIndex: number;
  /** 0-indexed page within the current category. */
  page: number;
  /** Topics discovered this sweep awaiting a full-thread fetch (FIFO). */
  pending: PendingTopic[];
  /** Max `last_activity` from a COMPLETED sweep; incremental sweeps skip topics at/below it. */
  highWater: string | null;
  /** Running max `last_activity` for the in-progress sweep; promoted to `highWater` on completion. */
  sweepMaxActivity: string | null;
  /** Unix ms of the last completed reconcile sweep; a new sweep reconciles once this ages out. */
  lastReconcileMs: number;
  /** Whether the in-progress sweep is a reconcile pass (ignore `highWater`). */
  reconciling: boolean;
}
