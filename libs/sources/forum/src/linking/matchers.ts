// Deterministic proposal↔forum-thread link classification (SPEC §3.7 high + medium). The low
// (embedding) path is deferred to M5 (KNOWN-005). All functions here are pure so both linking
// directions — the proposal-driven sweep and the thread-driven applier hook — share one rule set.

/** Recognised governance stage-tag prefixes. A thread is eligible for a community-curated (medium)
 *  link only if its title carries one of these — this keeps title matching conservative. */
const STAGE_TAGS = [
  'ARFC',
  'AIP',
  'TEMP CHECK',
  'TEMP-CHECK',
  'TEMPCHECK',
  'ARC',
  'RFC',
  'LIP',
  'GIP',
  'BGD',
  'DIRECT-TO-AIP',
];

export interface ForumThreadRef {
  host: string;
  /** Discourse topic id as a string (matches forum_thread.forum_topic_id). */
  topicId: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract Discourse thread references (`https://{host}/t/{slug}/{topicId}` — slug and trailing
 * post-number optional) from free text, restricted to the given hosts. Deduplicated.
 */
export function extractForumThreadRefs(text: string, hosts: readonly string[]): ForumThreadRef[] {
  const seen = new Set<string>();
  const refs: ForumThreadRef[] = [];
  for (const host of hosts) {
    const re = new RegExp(`https?://${escapeRegExp(host)}/t/(?:[^\\s/)\\]]+/)?(\\d+)`, 'gi');
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const topicId = m[1]!;
      const key = `${host}:${topicId}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ host, topicId });
      }
    }
  }
  return refs;
}

/** Lowercase, drop diacritics + punctuation, collapse whitespace — for conservative exact matching.
 *  NFKD splits accented letters into base + combining mark; `\p{M}` removes the mark (so `réserve`
 *  folds to `reserve`, not `re serve`), then non-alphanumerics collapse to single spaces. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strip leading recognised stage-tag brackets (e.g. `[ARFC]`, `[AIP-123]`, `[TEMP CHECK]`),
 *  returning the first tag found (uppercased) and the remaining title. Non-stage brackets stop the
 *  strip so unrelated bracketed prefixes aren't consumed. */
export function stripStageTag(title: string): { tag: string | null; stripped: string } {
  let rest = title.trim();
  let firstTag: string | null = null;
  for (;;) {
    const m = rest.match(/^\[([^\]]+)\]\s*/);
    if (m === null) break;
    const inner = m[1]!.trim().toUpperCase();
    const isStage =
      STAGE_TAGS.includes(inner) ||
      STAGE_TAGS.some((t) => inner.startsWith(`${t}-`) || inner.startsWith(`${t} `));
    if (!isStage) break;
    if (firstTag === null) firstTag = inner;
    rest = rest.slice(m[0].length);
  }
  return { tag: firstTag, stripped: rest.trim() };
}

/** The de-tagged, normalized form of a proposal title, or null when empty. Used as the left side of
 *  a community-curated (medium) title match; a proposal needs no stage tag. */
export function proposalTitleKey(title: string | null): string | null {
  if (title === null) return null;
  const n = normalizeTitle(stripStageTag(title).stripped);
  return n.length > 0 ? n : null;
}

/** The medium-match key of a thread title: null unless the thread carries a recognised stage tag
 *  (the community-curated signal), else its de-tagged, normalized title. */
export function threadTitleKey(title: string | null): string | null {
  if (title === null) return null;
  const { tag, stripped } = stripStageTag(title);
  if (tag === null) return null;
  const n = normalizeTitle(stripped);
  return n.length > 0 ? n : null;
}

export interface LinkProposal {
  title: string | null;
  description: string;
}

export interface LinkThread {
  host: string;
  topicId: string;
  title: string | null;
}

export type LinkConfidence = 'high' | 'medium';
export type LinkMethod = 'description_url' | 'community_curated';

export interface LinkClassification {
  confidence: LinkConfidence;
  linkMethod: LinkMethod;
}

/**
 * Classify a (proposal, thread) pair, highest confidence first:
 *  - HIGH: the proposal description contains a URL pointing to this thread → `description_url`.
 *  - MEDIUM: the thread carries a recognised stage tag AND its de-tagged, normalized title exactly
 *    matches the proposal's de-tagged, normalized title → `community_curated`.
 * Returns null when neither holds. Intentionally conservative (exact normalized match).
 */
export function classifyLink(
  proposal: LinkProposal,
  thread: LinkThread,
): LinkClassification | null {
  const refs = extractForumThreadRefs(proposal.description, [thread.host]);
  if (refs.some((r) => r.topicId === thread.topicId)) {
    return { confidence: 'high', linkMethod: 'description_url' };
  }

  const threadKey = threadTitleKey(thread.title);
  if (threadKey !== null && threadKey === proposalTitleKey(proposal.title)) {
    return { confidence: 'medium', linkMethod: 'community_curated' };
  }

  return null;
}
