import raw from './forum-synthesizer.md?raw';
import { defineTemplates, getTemplate } from './registry.js';
import type { PromptTemplate } from './types.js';
import {
  ForumSynthesisSchema,
  FORUM_SYNTHESIS_SCHEMA_NAME,
  type ForumSynthesis,
} from '../schemas/forum-synthesis.js';

// The forum-thread synthesizer template (M5-4.1). One model-agnostic prompt; the worker picks the
// model per job (`chooseForumModel`) and overrides the request model, so the frontmatter `model` is
// only the default. getTemplate returns PromptTemplate<unknown>; the cast restores the schema's
// static type (the runtime schema object IS ForumSynthesisSchema, set by defineTemplates).
export const FORUM_SYNTHESIZER_TEMPLATE = getTemplate(
  defineTemplates([{ raw, schema: ForumSynthesisSchema, schemaName: FORUM_SYNTHESIS_SCHEMA_NAME }]),
  'forum_synthesizer',
) as PromptTemplate<ForumSynthesis>;
