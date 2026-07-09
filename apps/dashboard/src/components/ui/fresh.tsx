'use client';

import { useEffect, useState } from 'react';

import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export type FreshProps = {
  timestamp: Date | number;
  /** Leading word; default "Updated". */
  prefix?: string;
  /** Re-render cadence in ms; default 10s. */
  intervalMs?: number;
  className?: string;
};

/** "Updated N ago" indicator for polled data; ticks and announces politely. */
export function Fresh({
  timestamp,
  prefix = 'Updated',
  intervalMs = 10_000,
  className,
}: FreshProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return (
    <span
      className={cn('font-mono text-caption text-ink-3', className)}
      aria-live="polite"
      suppressHydrationWarning
    >
      {prefix} {formatRelativeTime(timestamp)}
    </span>
  );
}
