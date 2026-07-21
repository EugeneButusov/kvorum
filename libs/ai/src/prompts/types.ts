import type { ZodType } from 'zod';
import type { LlmMessage } from '../llm/ports.js';

export interface PromptFrontmatter {
  name: string;
  version: string;
  model: string;
  schema: string;
  description: string;
  /** Optional AI feature this template serves, decoupled from `name` (#437). Absent → the feature
   *  IS the name (single-template case). Lets N template variants roll up to one feature. */
  feature?: string;
}

export interface PromptTemplate<T = unknown> {
  name: string;
  version: string;
  model: string;
  schema: ZodType<T>;
  description: string;
  body: string;
  /** See PromptFrontmatter.feature. `render()` uses `feature ?? name` as the request feature. */
  feature?: string;
}

export interface RenderedPrompt<T = unknown> {
  feature: string;
  promptVersion: string;
  model: string;
  schema: ZodType<T>;
  messages: LlmMessage[];
  inputContent: string;
}

export interface TemplateDef<T = unknown> {
  raw: string;
  schema: ZodType<T>;
  schemaName: string;
}

export class PromptTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptTemplateError';
  }
}

export class PromptRenderError extends Error {
  readonly missingKeys: string[];
  constructor(missingKeys: string[]) {
    super(`Prompt render failed: missing variable(s): ${missingKeys.join(', ')}`);
    this.name = 'PromptRenderError';
    this.missingKeys = missingKeys;
  }
}
