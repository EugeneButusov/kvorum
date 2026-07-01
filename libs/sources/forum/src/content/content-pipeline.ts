import type { DiscourseThread } from '../client/types';
import { forumMetrics } from '../metrics';
import { createTurndownService } from './turndown-config';

// Pinned turndown version (package.json) + the in-code rule revision. Bump the rules tag whenever
// turndown-config.ts changes so old rows keep their old raw_content and the §5.3 content-hash cache
// stays deterministic (ADR-034). Must match the `turndown` version pinned in package.json.
const TURNDOWN_VERSION = '7.2.4';
const RULES_VERSION = 'rules-v1';
export const CONTENT_PIPELINE_VERSION = `turndown@${TURNDOWN_VERSION}+${RULES_VERSION}`;

// Stateless across turndown() calls — one shared instance keeps normalisation deterministic.
const service = createTurndownService();

/** Normalise one post's `cooked` HTML to Markdown per the ADR-034 rules. Pure + deterministic for a
 *  given pipeline version. */
export function normalizePost(cookedHtml: string): string {
  return service.turndown(cookedHtml ?? '').trim();
}

export interface RenderedThread {
  /** The concatenated, normalised thread body destined for `forum_thread.raw_content`. */
  rawContent: string;
  /** The pipeline identity to stamp on `forum_thread.content_pipeline_version`. */
  contentPipelineVersion: string;
  /** Posts successfully rendered into the body (== thread.posts.length). */
  postCount: number;
}

/**
 * Render a full thread into deterministic `raw_content` (ADR-034): each post is prefixed with a
 * `**@{username}** at {iso8601}` header and posts are joined with `\n\n---\n\n`. A post whose HTML
 * fails to normalise is counted (forum_turndownFailures) and contributes an empty body rather than
 * sinking the whole thread.
 */
export function renderThread(
  thread: DiscourseThread,
  forumHost: string,
  // Test seam: the normaliser is injectable so the failure path can be exercised deterministically.
  normalize: (cookedHtml: string) => string = normalizePost,
): RenderedThread {
  const blocks = thread.posts.map((post) => {
    let body = '';
    try {
      body = normalize(post.cooked);
    } catch {
      forumMetrics.turndownFailures.add(1, { forum_host: forumHost });
    }
    const header = `**@${post.username}** at ${post.createdAt}`;
    return `${header}\n\n${body}`.trim();
  });

  return {
    rawContent: blocks.join('\n\n---\n\n'),
    contentPipelineVersion: CONTENT_PIPELINE_VERSION,
    postCount: thread.posts.length,
  };
}
