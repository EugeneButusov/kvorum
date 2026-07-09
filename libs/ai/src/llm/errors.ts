import type { ZodError } from 'zod';

export interface LlmSchemaViolationDetails {
  feature: string;
  promptVersion: string;
  inputHash: string;
  model: string;
  rawOutput: unknown;
  zodError: ZodError;
  attempts: number;
}

export class LlmSchemaViolationError extends Error {
  readonly feature: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly model: string;
  readonly rawOutput: unknown;
  readonly zodError: ZodError;
  readonly attempts: number;

  constructor(details: LlmSchemaViolationDetails) {
    super(
      `LLM structured output failed schema validation for feature="${details.feature}" ` +
        `model="${details.model}" after ${details.attempts} attempt(s)`,
    );
    this.name = 'LlmSchemaViolationError';
    this.feature = details.feature;
    this.promptVersion = details.promptVersion;
    this.inputHash = details.inputHash;
    this.model = details.model;
    this.rawOutput = details.rawOutput;
    this.zodError = details.zodError;
    this.attempts = details.attempts;
  }
}
