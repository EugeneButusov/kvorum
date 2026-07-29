// SPEC §5.7 — automatic Haiku↔Sonnet routing for forum-thread synthesis.
//
// The synthesizer prompt is model-agnostic; this pure function picks which model runs each job.
// Both ids MUST be present in ANTHROPIC_PRICING (an unpriced model throws at completion time).
export const FORUM_MODEL_HAIKU = 'claude-haiku-4-5';
export const FORUM_MODEL_SONNET = 'claude-sonnet-5';

export type ForumRoutingReason = 'long' | 'contentious' | 'short';

export interface ForumModelRoute {
  model: string;
  reason: ForumRoutingReason;
  estimatedTokens: number;
}

// Coarse by design (SPEC: "a coarse heuristic"). Named knobs; formal tuning is later eval work.
const CHARS_PER_TOKEN = 4; // rough English estimate — avoids a network token count
const TOKEN_ROUTE_THRESHOLD = 30_000; // SPEC §5.7: Haiku under 30k tokens, else Sonnet
const CONTENTION_WINDOW_TOKENS = 5_000; // SPEC §5.7: polarity over the first ~5k tokens
const CONTENTION_MIN_MARKERS = 4; // need enough signal before calling anything contentious
const CONTENTION_BALANCE = 0.4; // both poles must be meaningfully present (a polarized debate)

// Stems (matched as `\b<stem>\w*`, case-insensitive) — strong polarity signals only. We avoid
// noisy words like "no"/"but"/"however" that carry no reliable stance.
const OPPOSITION_MARKERS = [
  'oppos', // oppose/opposed/opposition
  'against',
  'disagree',
  'reject',
  'concern',
  'risk',
  'problem',
  'objection',
  'veto',
  'flaw',
  'downside',
  'drawback',
  'unacceptable',
  'doubt',
  'danger',
  'harmful',
];
const SUPPORT_MARKERS = [
  'support',
  'agree', // note: `\b` keeps this from matching "disagree"
  'favor',
  'favour',
  'approv', // approve/approved/approval
  'endorse',
  'benefit',
  'advantage',
];

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function countMarkers(haystack: string, markers: readonly string[]): number {
  let total = 0;
  for (const stem of markers) {
    const matches = haystack.match(new RegExp(`\\b${stem}\\w*`, 'gi'));
    if (matches) total += matches.length;
  }
  return total;
}

/** Coarse contentiousness: the window shows a *polarized* debate (both poles present), not merely
 *  negative sentiment. One-sided criticism is not contentious. */
function isContentious(window: string): boolean {
  const oppose = countMarkers(window, OPPOSITION_MARKERS);
  const support = countMarkers(window, SUPPORT_MARKERS);
  const total = oppose + support;
  if (total < CONTENTION_MIN_MARKERS) return false;
  const balance = Math.min(oppose, support) / Math.max(oppose, support);
  return balance >= CONTENTION_BALANCE;
}

/**
 * Pick the synthesis model for a thread's `raw_content` (SPEC §5.7). Sonnet when the thread is long
 * (>= 30k estimated tokens) or short-but-contentious; Haiku otherwise. `reason` is recorded alongside
 * the model in provenance so routing is auditable. Pure + deterministic → the cache key (which
 * excludes model) never collides across models for the same input.
 */
export function chooseForumModel(rawContent: string): ForumModelRoute {
  const estimatedTokens = estimateTokens(rawContent);
  if (estimatedTokens >= TOKEN_ROUTE_THRESHOLD) {
    return { model: FORUM_MODEL_SONNET, reason: 'long', estimatedTokens };
  }
  const window = rawContent.slice(0, CONTENTION_WINDOW_TOKENS * CHARS_PER_TOKEN);
  if (isContentious(window)) {
    return { model: FORUM_MODEL_SONNET, reason: 'contentious', estimatedTokens };
  }
  return { model: FORUM_MODEL_HAIKU, reason: 'short', estimatedTokens };
}
