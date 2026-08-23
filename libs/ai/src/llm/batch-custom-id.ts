import { createHash } from 'node:crypto';

/**
 * Anthropic's Message Batches API requires every request's `custom_id` to match
 * `^[a-zA-Z0-9_-]{1,64}$`. Our natural entity refs (`proposal:<id>`,
 * `forum_thread:<id>`) contain a `:` and can exceed 64 chars, which the API rejects
 * with a 400 invalid_request_error. Sanitise them: replace any disallowed character
 * with `_`, and fall back to a sha256 hex digest (exactly 64 chars, always
 * pattern-valid) when the sanitised form would still be out of range.
 *
 * The custom_id is only an opaque correlation key between submit and result (the
 * pending map is keyed by it and the request/context carry everything needed to
 * persist), so this transformation is safe as long as it is deterministic and unique
 * per ref — which it is: distinct refs sanitise to distinct strings, and the hash
 * fallback is collision-resistant.
 */
export function toBatchCustomId(ref: string): string {
  const sanitized = ref.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (sanitized.length >= 1 && sanitized.length <= 64) return sanitized;
  return createHash('sha256').update(ref, 'utf8').digest('hex');
}
