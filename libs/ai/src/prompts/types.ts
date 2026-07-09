import type { ZodType } from 'zod';
import type { LlmMessage } from '../llm/ports.js';

export interface PromptFrontmatter {
  name: string;
  version: string;
  model: string;
  schema: string;
  description: string;
}

export interface PromptTemplate<T = unknown> {
  name: string;
  version: string;
  model: string;
  schema: ZodType<T>;
  description: string;
  body: string;
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
