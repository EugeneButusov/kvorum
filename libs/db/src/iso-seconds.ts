// Canonical ISO-8601-to-seconds formatting for API timestamps, e.g. "2026-07-01T08:00:00Z".
// The read repositories store `timestamptz`/`DateTime64` as `Date` and expose seconds-precision ISO
// strings; this is the one place that truncation lives (previously copied across every source repo).

/** Seconds-precision ISO with a `Z` suffix; `null` passes through for nullable columns. */
export function isoSeconds(value: Date | null): string | null {
  return value === null ? null : `${value.toISOString().slice(0, 19)}Z`;
}

/** Non-null variant for required timestamp fields. */
export function isoSecondsRequired(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}
