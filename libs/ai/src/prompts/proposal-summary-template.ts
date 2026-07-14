import raw from './proposal-summarizer.md?raw';
import { defineTemplates, getTemplate } from './registry.js';
import type { PromptTemplate } from './types.js';
import {
  ProposalSummarySchema,
  PROPOSAL_SUMMARY_SCHEMA_NAME,
  type ProposalSummary,
} from '../schemas/proposal-summary.js';

// Single source for the binding-proposal summarizer template. #437 adds the signaling variant.
// getTemplate returns PromptTemplate<unknown>; the cast restores the schema's static type (the
// runtime schema object IS ProposalSummarySchema, set by defineTemplates).
export const PROPOSAL_SUMMARY_TEMPLATE = getTemplate(
  defineTemplates([
    { raw, schema: ProposalSummarySchema, schemaName: PROPOSAL_SUMMARY_SCHEMA_NAME },
  ]),
  'proposal_summarizer',
) as PromptTemplate<ProposalSummary>;
