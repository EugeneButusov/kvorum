import { z } from 'zod';

/** Registry schema-label; must equal the `schema:` frontmatter field of the mismatch template. */
export const MISMATCH_ANALYSIS_SCHEMA_NAME = 'MismatchAnalysisSchema';

// SPEC §5.6 — the structured calldata-vs-prose mismatch analysis for a binding proposal.
export const MismatchAnalysisSchema = z.object({
  overall_assessment: z.enum([
    'consistent',
    'minor_discrepancy',
    'material_discrepancy',
    'severe_discrepancy',
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
  description_actions: z.array(
    z.object({
      claim: z.string(),
      location: z.string(), // brief reference to where in the description
    }),
  ),
  calldata_actions: z.array(
    z.object({
      action_index: z.number(),
      summary: z.string(),
      significance: z.enum(['high', 'medium', 'low']),
    }),
  ),
  discrepancies: z.array(
    z.object({
      type: z.enum([
        'value_mismatch',
        'omitted_in_description',
        'extra_in_description',
        'misleading_phrasing',
        'target_mismatch',
      ]),
      description: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
      description_excerpt: z.string().nullable(),
      related_action_indices: z.array(z.number()),
    }),
  ),
  reasoning: z.string().max(2000),
});

export type MismatchAnalysis = z.infer<typeof MismatchAnalysisSchema>;
