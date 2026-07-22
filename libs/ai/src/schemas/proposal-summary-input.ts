import type { ProposalAction } from '@libs/db';
import { computeInputHash } from '../llm/provenance.js';
import { canonicalInputContent } from '../prompts/renderer.js';

/**
 * Canonical JSON of the decoded actions — sorted by `action_index` and projected to the fields the
 * summarizer hashes, so the input hash is stable across row-order and column churn. `target_address`
 * is kept RAW (not lowercased) — this is a hash input, not a display value.
 */
export function serializeDecodedActions(actions: ProposalAction[]): string {
  const rows = actions
    .slice()
    .sort((a, b) => a.action_index - b.action_index)
    .map((a) => ({
      action_index: a.action_index,
      target_address: a.target_address,
      target_chain_id: a.target_chain_id,
      value_wei: a.value_wei,
      function_signature: a.function_signature,
      decoded_function: a.decoded_function,
      decoded_arguments: a.decoded_arguments,
    }));
  return JSON.stringify(rows);
}

/**
 * The canonical `inputContent` for a proposal summary — `{description, decoded_actions}` run through
 * the same canonicalizer `render()` uses. Both the worker (via the assembler + `render`) and the API
 * (via this) MUST produce byte-identical content, or the API cache-misses a summary that exists.
 * Guarded by a drift test in proposal-summary-input.spec.ts.
 */
export function proposalSummaryInputContent(
  description: string,
  actions: ProposalAction[],
): string {
  return canonicalInputContent({
    description,
    decoded_actions: serializeDecodedActions(actions),
  });
}

/** The `ai_output.input_hash` for a proposal summary: `sha256:` of the canonical input content. */
export function proposalSummaryInputHash(description: string, actions: ProposalAction[]): string {
  return computeInputHash(proposalSummaryInputContent(description, actions));
}
