export { AllProvidersFailedError } from './all-providers-failed.error.js';
export { ChainConfigError } from './chain-config.error.js';
export { ClientStoppedError } from './client-stopped.error.js';
export { NotImplementedError } from './not-implemented.error.js';

/**
 * Verified ethers v6 error code → ErrorReason mapping (empirical spike, subtask 3).
 *
 * Confirmed shapes:
 *   TIMEOUT              → timeout  (covers real timeouts AND HTTP 429 — ethers v6 converts
 *                                    429 responses to TIMEOUT internally; indistinguishable
 *                                    without parsing private error internals)
 *   SERVER_ERROR 5xx     → http_5xx  (e.response?.statusCode in 500–599)
 *   SERVER_ERROR other   → unknown
 *   ECONNREFUSED         → network_error
 *   NETWORK_ERROR        → network_error
 *   UNKNOWN_ERROR + inner JSON-RPC code → transparent  (caller-scoped: method not found,
 *                                                        invalid params, etc.)
 *   UNSUPPORTED_OPERATION → unknown  (bad/non-JSON response body)
 *   CALL_EXCEPTION / INVALID_ARGUMENT / MISSING_ARGUMENT / NOT_IMPLEMENTED → transparent
 */
export type ErrorReason = 'timeout' | 'network_error' | 'http_5xx' | 'http_429' | 'unknown';

const TRANSPARENT_CODES = new Set([
  'CALL_EXCEPTION',
  'INVALID_ARGUMENT',
  'MISSING_ARGUMENT',
  'NOT_IMPLEMENTED',
]);

export function categorizeError(err: unknown): ErrorReason | 'transparent' {
  if (err === null || typeof err !== 'object') return 'unknown';
  const e = err as Record<string, unknown>;
  const code = e['code'];

  if (code === 'TIMEOUT') return 'timeout';

  if (code === 'ECONNREFUSED' || code === 'NETWORK_ERROR') return 'network_error';

  if (code === 'SERVER_ERROR') {
    const statusCode = (e['response'] as Record<string, unknown> | undefined)?.['statusCode'];
    if (typeof statusCode === 'number' && statusCode >= 500 && statusCode <= 599) return 'http_5xx';
    return 'unknown';
  }

  if (code === 'UNKNOWN_ERROR') {
    // JSON-RPC envelope error — the inner code is a caller-scoped issue, not a provider fault
    const innerCode = (e['error'] as Record<string, unknown> | undefined)?.['code'];
    if (typeof innerCode === 'number') return 'transparent';
    return 'unknown';
  }

  if (code === 'UNSUPPORTED_OPERATION') return 'unknown';

  if (typeof code === 'string' && TRANSPARENT_CODES.has(code)) return 'transparent';

  return 'unknown';
}

/**
 * Strips URL-bearing fields from an ethers error before attaching it to
 * AllProvidersFailedError.attempts — prevents secret RPC URLs leaking into
 * logs or error reports (ADR-028).
 */
export function scrubError(err: unknown): unknown {
  if (err === null || typeof err !== 'object') return err;
  const e = err as Record<string, unknown>;
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'request') continue; // FetchRequest contains the full URL
    if (k === 'url' && typeof v === 'string') {
      scrubbed[k] = '[redacted]';
      continue;
    }
    scrubbed[k] = v;
  }
  return scrubbed;
}
