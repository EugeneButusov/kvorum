import signalingRaw from './proposal-summarizer-signaling.md?raw';
import raw from './proposal-summarizer.md?raw';
import { defineTemplates, getTemplate } from './registry.js';
import type { PromptTemplate } from './types.js';
import {
  ProposalSummarySchema,
  PROPOSAL_SUMMARY_SCHEMA_NAME,
  type ProposalSummary,
} from '../schemas/proposal-summary.js';

// The two summarizer templates (#437): binding (`proposal_summarizer`) and Snapshot signaling
// (`proposal_summarizer_signaling`). Distinct template names, one shared `feature`
// (`proposal_summarizer`, declared in each template's frontmatter) — so budget, config, cost-log,
// metrics and queue routing all roll up to a single feature. getTemplate returns
// PromptTemplate<unknown>; the cast restores the schema's static type (the runtime schema object
// IS ProposalSummarySchema, set by defineTemplates).
const SUMMARY_TEMPLATES = defineTemplates([
  { raw, schema: ProposalSummarySchema, schemaName: PROPOSAL_SUMMARY_SCHEMA_NAME },
  { raw: signalingRaw, schema: ProposalSummarySchema, schemaName: PROPOSAL_SUMMARY_SCHEMA_NAME },
]);

export const PROPOSAL_SUMMARY_TEMPLATE = getTemplate(
  SUMMARY_TEMPLATES,
  'proposal_summarizer',
) as PromptTemplate<ProposalSummary>;

export const PROPOSAL_SUMMARY_SIGNALING_TEMPLATE = getTemplate(
  SUMMARY_TEMPLATES,
  'proposal_summarizer_signaling',
) as PromptTemplate<ProposalSummary>;
