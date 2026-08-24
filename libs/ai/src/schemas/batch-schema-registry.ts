import type { ZodType } from 'zod';
import { ForumSynthesisSchema } from './forum-synthesis.js';
import { ProposalSummarySchema } from './proposal-summary.js';

/**
 * The output schema for each Anthropic **batch** feature, keyed by feature name. Used to validate a
 * batch result when persisting it — including after a restart, where the original `CompletionRequest`
 * (and its live Zod `schema`) is gone and only the durable `ai_batch` descriptor survives. Only the
 * two batch features appear here; sync features (mismatch/embedding) never go through this path.
 */
const BATCH_SCHEMAS: Record<string, ZodType<unknown>> = {
  proposal_summarizer: ProposalSummarySchema,
  forum_synthesizer: ForumSynthesisSchema,
};

export function batchSchemaFor(feature: string): ZodType<unknown> {
  const schema = BATCH_SCHEMAS[feature];
  if (schema === undefined) {
    throw new Error(`No batch output schema registered for feature "${feature}"`);
  }
  return schema;
}
