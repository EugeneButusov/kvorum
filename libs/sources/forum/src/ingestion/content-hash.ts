import { createHash } from 'node:crypto';

/** Deterministic JSON with recursively sorted object keys, so two structurally-equal payloads hash
 *  identically regardless of key order. */
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

/** Hash over a thread's raw source slice (ADR-071): the hash keys the mutable-latest archive, so it
 *  must cover exactly what a forum edit changes — post bodies (`cooked`), authorship, and thread
 *  metadata. It is deliberately independent of the turndown pipeline version: a pipeline bump
 *  re-derives `raw_content` from the SAME archived source without churning the archive. */
export function contentHash(slice: unknown): string {
  return createHash('sha256').update(stableStringify(slice)).digest('hex');
}
