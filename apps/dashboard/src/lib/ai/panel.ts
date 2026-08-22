// Maps the API's AI payloads onto AIPanel props, and models a server-fetched AI section's outcome.
//
// The API is content-addressed: an AI read recomputes the input_hash from the *current* entity
// content and looks the row up, so a content change makes the lookup miss and the endpoint 404s.
// There is therefore no "stale" row to observe — a section is either present (`ok`), not yet
// generated (`coming-soon`, from a 404/null), deliberately skipped (`skipped`, e.g. a non-English
// forum thread), or the fetch itself failed (`failed`). The AIPanel `stale` state is unused here.

import type { AIProvenance } from '@/components/ui/ai-panel';
import type { components } from '@/lib/api/schema';

export type ProposalAiSummary = components['schemas']['ProposalAiSummaryDto'];
export type ProposalAiMismatchFlag = components['schemas']['ProposalAiMismatchFlagDto'];
export type ProposalMismatch = components['schemas']['ProposalMismatchDto'];
export type ForumSynthesis = components['schemas']['ForumSynthesisDto'];
export type ForumSynthesisMeta = components['schemas']['ForumSynthesisMetaDto'];
export type SimilarProposalItem = components['schemas']['SimilarProposalItemDto'];

export type AiConfidence = 'high' | 'medium' | 'low';

/** A server-fetched AI section outcome. `skipped` carries the reason (e.g. `non_english`). */
export type AiSection<T> =
  | { state: 'ok'; data: T }
  | { state: 'coming-soon' }
  | { state: 'skipped'; reason: string }
  | { state: 'failed' };

/** Forum synthesis carries its provenance in a top-level `_meta` (not on `data`), and a non-English
 *  thread returns 200 with `data: null` + `_meta.skipped_reason` — hence its own result shape. */
export type ForumSynthesisSection =
  | { state: 'ok'; data: ForumSynthesis; meta: ForumSynthesisMeta }
  | { state: 'coming-soon' }
  | { state: 'skipped'; reason: string }
  | { state: 'failed' };

/** Narrow the API's free-string confidence field to the AIPanel union (undefined when absent). */
export function toAiConfidence(value: string | null | undefined): AiConfidence | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

type ProvenanceMeta = {
  model?: string;
  prompt_version?: string;
  generated_at?: string;
};

/** Build the AIPanel provenance disclosure from an AI `_meta`; undefined when nothing meaningful. */
export function toProvenance(meta: ProvenanceMeta | null | undefined): AIProvenance | undefined {
  if (!meta) return undefined;
  const parsed = meta.generated_at ? Date.parse(meta.generated_at) : NaN;
  const provenance: AIProvenance = {
    model: meta.model,
    promptVersion: meta.prompt_version,
    generatedAt: Number.isNaN(parsed) ? undefined : parsed,
  };
  return provenance.model || provenance.promptVersion || provenance.generatedAt != null
    ? provenance
    : undefined;
}
