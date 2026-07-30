import { computeInputHash } from '../llm/provenance.js';

/**
 * The canonical `inputContent` for a forum synthesis is the thread's `raw_content` verbatim.
 * SPEC §5.7 caches by `sha256(raw_content)` ONLY — not the proposal title or DAO context, which are
 * stable for a given thread. `raw_content` is already deterministic per pipeline version (ADR-034),
 * so hashing it verbatim is safe. Worker and API MUST hash the identical string, or the API
 * cache-misses a synthesis that exists — so both go through here.
 */
export function forumSynthesisInputContent(rawContent: string): string {
  return rawContent;
}

/** The `ai_output.input_hash` for a forum synthesis: `sha256:` of the thread's `raw_content`. */
export function forumSynthesisInputHash(rawContent: string): string {
  return computeInputHash(forumSynthesisInputContent(rawContent));
}
