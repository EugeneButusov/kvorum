import type { ProposalAction } from '@libs/db';
import { serializeDecodedActions } from './proposal-summary-input.js';
import { computeInputHash } from '../llm/provenance.js';
import { canonicalInputContent } from '../prompts/renderer.js';

/**
 * The canonical `inputContent` for a calldata-vs-prose mismatch analysis — `{description,
 * decoded_actions}` run through the same canonicalizer `render()` uses (SPEC §5.6). Both the worker
 * (via the assembler + `render`) and the API read side (via this) MUST produce byte-identical content,
 * or the API cache-misses a mismatch analysis that exists. Guarded by a drift test in
 * mismatch-input.spec.ts.
 *
 * This is byte-identical to the summary input content today only because both features render the same
 * two vars; that is a coincidence, not a contract, so mismatch keeps its own helper and drift guard
 * rather than reusing `proposalSummaryInputHash`.
 */
export function mismatchInputContent(description: string, actions: ProposalAction[]): string {
  return canonicalInputContent({
    description,
    decoded_actions: serializeDecodedActions(actions),
  });
}

/** The `ai_output.input_hash` for a mismatch analysis: `sha256:` of the canonical input content. */
export function mismatchInputHash(description: string, actions: ProposalAction[]): string {
  return computeInputHash(mismatchInputContent(description, actions));
}
