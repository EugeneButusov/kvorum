/**
 * Resolves after `ms` milliseconds. Thin wrapper around setTimeout intended
 * for retry/backoff/delay logic — not for production timing critical paths.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
