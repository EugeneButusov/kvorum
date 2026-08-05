import type { ProposalAction } from '@libs/db';
import { computeInputHash } from '../llm/provenance.js';

// SPEC §5.8 / ADR-081. The proposal-embedding composition is deterministic and change-controlled:
// any edit to the functions below MUST bump `EMBEDDING_VERSION` (a golden test in the spec enforces
// this), because the cache-check keys on `embedding_version` — a bump re-embeds the whole corpus.
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_VERSION = 'text-embedding-3-small/v1';

// `text-embedding-3-small` caps at ~8,191 tokens (~4 chars/token); cap the description well under it
// so a long proposal still embeds (truncated) rather than hard-failing the API into the DLQ.
export const DESCRIPTION_CHAR_CAP = 24_000;

/** The function name portion of a signature: `setReserveFactor(uint256)` → `setReserveFactor`. */
function bareSignatureName(signature: string | null): string | null {
  if (signature === null) return null;
  const name = (signature.split('(')[0] ?? '').trim();
  return name.length > 0 ? name : null;
}

/**
 * SPEC §5.8 one-line summary of the decoded on-chain actions — **function names only** (names recur
 * across DAOs on shared governor frameworks, giving strong cross-DAO similarity signal; raw addresses
 * and decoded arguments are opaque noise). Names are listed in `action_index` order (NOT de-duped —
 * repetition is meaningful shape), each resolved `decoded_function` → bare signature name → `raw call`.
 */
export function summarizeActionsOneLine(actions: ProposalAction[]): string {
  if (actions.length === 0) return 'No on-chain actions.';
  const names = actions
    .slice()
    .sort((a, b) => a.action_index - b.action_index)
    .map((a) => a.decoded_function ?? bareSignatureName(a.function_signature) ?? 'raw call');
  return `Actions (${names.length}): ${names.join(', ')}`;
}

/**
 * The deterministic natural-text embedded for a proposal (SPEC §5.8): title (omitted when null/blank)
 * + description (capped) + the one-line action summary, blank-line separated. This exact string is
 * BOTH what `text-embedding-3-small` ingests AND what gets hashed — so "unchanged input ⇒ cache hit"
 * is airtight. Frozen for a given `EMBEDDING_VERSION`.
 */
export function proposalEmbeddingInputContent(
  title: string | null,
  description: string,
  actions: ProposalAction[],
): string {
  const parts: string[] = [];
  if (title !== null && title.trim() !== '') parts.push(title);
  parts.push(description.slice(0, DESCRIPTION_CHAR_CAP));
  parts.push(summarizeActionsOneLine(actions));
  return parts.join('\n\n');
}

/** `proposal_embedding.input_hash`: `sha256:` of the literal composed embed string. */
export function proposalEmbeddingInputHash(
  title: string | null,
  description: string,
  actions: ProposalAction[],
): string {
  return computeInputHash(proposalEmbeddingInputContent(title, description, actions));
}
