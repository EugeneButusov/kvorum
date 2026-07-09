import { z, type ZodType } from 'zod';
import type { JsonSchema } from './ports.js';

const UNSUPPORTED_KEYWORDS = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'pattern',
  'format',
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(strip);
  }
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_KEYWORDS.has(key)) continue;
      out[key] = strip(value);
    }
    return out;
  }
  return node;
}

export function toStrippedJsonSchema(schema: ZodType<unknown>): JsonSchema {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  return strip(jsonSchema) as JsonSchema;
}
