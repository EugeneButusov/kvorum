import { z } from 'zod';

/** Registry schema-label; must equal the `schema:` frontmatter field of the summarizer template. */
export const PROPOSAL_SUMMARY_SCHEMA_NAME = 'ProposalSummarySchema';

// SPEC §5.5 — the structured extraction produced for every binding proposal.
export const ProposalSummarySchema = z.object({
  tldr: z.string().max(400),
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
  key_changes: z
    .array(
      z.object({
        description: z.string(),
        significance: z.enum(['high', 'medium', 'low']),
      }),
    )
    .max(5),
  beneficiaries: z.array(z.string()).optional(),
  funding_amount_usd: z.string().nullable(),
  notable_concerns: z.array(z.string()).optional(),
});

export type ProposalSummary = z.infer<typeof ProposalSummarySchema>;
