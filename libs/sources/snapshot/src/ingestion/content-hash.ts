import { createHash } from 'node:crypto';

/** Deterministic JSON with recursively sorted object keys — so two structurally-equal payloads
 *  hash identically regardless of GraphQL field order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

/** Hash over the whole raw poll-response slice (ADR-071): any edit — title/body/choices,
 *  state, or the active→final scores_state flip — changes the hash and drives a mutable-latest
 *  re-archive; an unchanged re-poll hashes identically and is skipped by the consumer. */
export function contentHash(slice: unknown): string {
  return createHash('sha256').update(stableStringify(slice)).digest('hex');
}
