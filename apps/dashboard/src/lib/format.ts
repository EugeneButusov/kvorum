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

const dateOnly = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const dateTime = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

/** Absolute date, e.g. "Jul 12, 2026". */
export function formatDate(input: Date | number | string): string {
  return dateOnly.format(new Date(input));
}

/** Absolute date + time in UTC, e.g. "Jul 12, 2026, 08:30 UTC". */
export function formatDateTime(input: Date | number | string): string {
  return dateTime.format(new Date(input));
}

/**
 * Relative voting deadline, e.g. "ends in 3d" (future) / "ended 2w ago" (past). Null-safe so a
 * proposal without a close time renders nothing.
 */
export function formatDeadline(
  input: Date | number | string | null,
  now: number = Date.now(),
): string | null {
  if (input == null) return null;
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return null;
  const future = then >= now;
  const seconds = Math.abs(Math.round((then - now) / 1000));
  const unit =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.round(seconds / 60)}m`
        : seconds < 86_400
          ? `${Math.round(seconds / 3600)}h`
          : seconds < 2_592_000
            ? `${Math.round(seconds / 86_400)}d`
            : seconds < 31_536_000
              ? `${Math.round(seconds / 2_592_000)}mo`
              : `${Math.round(seconds / 31_536_000)}y`;
  return future ? `ends in ${unit}` : `ended ${unit} ago`;
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
