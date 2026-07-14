import { createHash } from 'node:crypto';
import type { CompletionRequest, Provenance } from './ports.js';

export interface Clock {
  now(): string; // ISO-8601 timestamp
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export function computeInputHash(content: string): string {
  const hex = createHash('sha256').update(content, 'utf8').digest('hex');
  return `sha256:${hex}`;
}

export function buildProvenance(
  req: CompletionRequest<unknown>,
  inputHash: string,
  clock: Clock,
): Provenance {
  return {
    feature: req.feature,
    model: req.model,
    promptVersion: req.promptVersion,
    inputHash,
    generatedAt: clock.now(),
  };
}
