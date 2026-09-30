import type { ZodError } from 'zod';
import type { CompletionProviderId, CostUsd } from './ports.js';

export interface LlmSchemaViolationDetails {
  feature: string;
  promptVersion: string;
  inputHash: string;
  provider: CompletionProviderId;
  model: string;
  generationProfileId: string;
  cost: CostUsd;
  rawOutput: unknown;
  zodError: ZodError;
  attempts: number;
}

export class LlmSchemaViolationError extends Error {
  readonly feature: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly provider: CompletionProviderId;
  readonly model: string;
  readonly generationProfileId: string;
  readonly cost: CostUsd;
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
    this.provider = details.provider;
    this.model = details.model;
    this.generationProfileId = details.generationProfileId;
    this.cost = details.cost;
    this.rawOutput = details.rawOutput;
    this.zodError = details.zodError;
    this.attempts = details.attempts;
  }
}
