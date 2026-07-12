/** Parse a positive-number env var (fractional allowed), falling back to `fallback` for
 *  unset/malformed/non-positive values. */
export function readPositiveNumber(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Parse a millisecond-interval env var. Semantic alias of `readPositiveNumber`. */
export function readIntervalMs(envName: string, fallback: number): number {
  return readPositiveNumber(envName, fallback);
}

/** Parse a positive-integer env var, falling back to `fallback` for unset/malformed/non-positive
 *  values. Uses `parseInt`, so trailing/fractional garbage truncates to the leading integer. */
export function readPositiveInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
