import raw from './mismatch-detector.md?raw';
import { defineTemplates, getTemplate } from './registry.js';
import type { PromptTemplate } from './types.js';
import {
  MismatchAnalysisSchema,
  MISMATCH_ANALYSIS_SCHEMA_NAME,
  type MismatchAnalysis,
} from '../schemas/mismatch-analysis.js';

// The calldata-vs-prose mismatch template (M5-3.1). Single template, one feature (`mismatch_detector`,
// which the name defaults to). The real prompt engineering + surfacing threshold is #440; this is the
// initial v1.0 the pipe runs against. getTemplate returns PromptTemplate<unknown>; the cast restores
// the schema's static type (the runtime schema object IS MismatchAnalysisSchema, set by defineTemplates).
export const MISMATCH_DETECTOR_TEMPLATE = getTemplate(
  defineTemplates([
    { raw, schema: MismatchAnalysisSchema, schemaName: MISMATCH_ANALYSIS_SCHEMA_NAME },
  ]),
  'mismatch_detector',
) as PromptTemplate<MismatchAnalysis>;
