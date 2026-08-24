import { z } from 'zod';

/** Registry schema-label; must equal the `schema:` frontmatter field of the summarizer template. */
export const PROPOSAL_SUMMARY_SCHEMA_NAME = 'ProposalSummarySchema';

// Upper bounds for the free-form fields. These are soft *quality* limits, not correctness
// constraints — but structured-output models routinely overrun them, and `toStrippedJsonSchema`
// (llm/schema.ts) strips `maxLength`/`maxItems` from the JSON schema we send Anthropic (unsupported
// keywords), so the model is never even told them. Rejecting an over-long-but-otherwise-valid
// response would dead-letter a response we already paid for and, on backfill re-walks, re-charge it
// forever. So we CLAMP over-long values instead of rejecting them (see the `z.preprocess` wrappers).
const TLDR_MAX = 600;
const KEY_CHANGES_MAX = 8;

/** Trim a string to <= max chars at a word boundary when possible (avoids mid-word cuts). */
function clampText(value: unknown, max: number): unknown {
  if (typeof value !== 'string' || value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.7 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/** Keep the first `max` items of an array (they lead with the most significant). */
function clampArray(value: unknown, max: number): unknown {
  return Array.isArray(value) && value.length > max ? value.slice(0, max) : value;
}

// SPEC §5.5 — the structured extraction produced for every binding proposal.
export const ProposalSummarySchema = z.object({
  tldr: z.preprocess((v) => clampText(v, TLDR_MAX), z.string().max(TLDR_MAX)),
  proposal_type: z.enum([
    'parameter_change',
    'treasury_allocation',
    'contract_upgrade',
    'protocol_addition',
    'protocol_deprecation',
    'governance_change',
    'signaling',
    'other',
  ]),
  proposal_type_confidence: z.enum(['high', 'medium', 'low']),
  affected_contracts: z.array(z.string()),
  key_changes: z.preprocess(
    (v) => clampArray(v, KEY_CHANGES_MAX),
    z
      .array(
        z.object({
          description: z.string(),
          significance: z.enum(['high', 'medium', 'low']),
        }),
      )
      .max(KEY_CHANGES_MAX),
  ),
  beneficiaries: z.array(z.string()).optional(),
  funding_amount_usd: z.string().nullable(),
  notable_concerns: z.array(z.string()).optional(),
});

export type ProposalSummary = z.infer<typeof ProposalSummarySchema>;
