/** Compact relative time, e.g. "just now", "3m ago", "5h ago", "2d ago". */
export function formatRelativeTime(input: Date | number, now: number = Date.now()): string {
  const then = typeof input === 'number' ? input : input.getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Compact number with M/B units, e.g. 1_234_567 → "1.2M". */
export function formatCompactNumber(value: number): string {
  return compact.format(value);
}

/** Voting-power figure: compact number + optional unit, e.g. "1.2M COMP". */
export function formatPower(value: number, unit?: string): string {
  const n = formatCompactNumber(value);
  return unit ? `${n} ${unit}` : n;
}
