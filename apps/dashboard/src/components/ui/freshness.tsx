'use client';

import { Fresh } from './fresh';
import { LiveDot } from './live-dot';

export type FreshnessProps = {
  /** Whether the source is actively polling; nothing renders when false (settled data). */
  active: boolean;
  /** Last successful poll (ms epoch), for the "updated N ago" indicator. */
  updatedAt: number;
  /** Polling failed — show "retrying" rather than letting the view go silently stale. */
  isError?: boolean;
  /** Polling stopped because remaining quota ran out (ADR-035). */
  isPaused?: boolean;
};

/**
 * Honest freshness for any polled section (§6.16): a live dot + "updated N ago" while polling,
 * "— retrying" on error, and an explicit paused message when quota runs out. Renders nothing on
 * settled (non-active) data. Reused across the tally (§6.9) and the homepage's polled sections (§6.4).
 */
export function Freshness({ active, updatedAt, isError, isPaused }: FreshnessProps) {
  if (!active) return null;

  if (isPaused) {
    return (
      <span className="font-mono text-caption text-note-ink" role="status">
        Live updates paused — refresh to retry
      </span>
    );
  }

  if (isError) {
    return (
      <span className="flex items-center gap-1.5 text-warn-ink" role="status">
        <Fresh timestamp={updatedAt} /> — retrying
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5" role="status">
      <LiveDot live />
      <Fresh timestamp={updatedAt} />
    </span>
  );
}
