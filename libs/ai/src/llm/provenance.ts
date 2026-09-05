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

/** Build provenance from the minimal fields, so it can be produced from durable batch state (which
 *  has no live `CompletionRequest`) as well as from a request. */
export function buildProvenanceFromFields(
  fields: { feature: string; model: string; promptVersion: string; routingReason?: string },
  inputHash: string,
  clock: Clock,
): Provenance {
  return {
    feature: fields.feature,
    model: fields.model,
    promptVersion: fields.promptVersion,
    inputHash,
    generatedAt: clock.now(),
    ...(fields.routingReason !== undefined ? { routingReason: fields.routingReason } : {}),
  };
}

export function buildProvenance(
  req: CompletionRequest<unknown>,
  inputHash: string,
  clock: Clock,
): Provenance {
  return buildProvenanceFromFields(
    {
      feature: req.feature,
      model: req.model,
      promptVersion: req.promptVersion,
      ...(req.routingReason !== undefined ? { routingReason: req.routingReason } : {}),
    },
    inputHash,
    clock,
  );
}
