'use client';

import { useSyncExternalStore } from 'react';

import { getQuota, pollInterval, subscribeQuota, type PollKind, type Quota } from './quota';

/** Subscribe to the live rate-limit quota (updated from RateLimit-* response headers). */
export function useQuota(): Quota {
  return useSyncExternalStore(subscribeQuota, getQuota, () => null);
}

/** Whether polling of the given kind is currently paused, plus the live quota. */
export function useAdaptivePoll(kind: PollKind): { quota: Quota; paused: boolean } {
  const quota = useQuota();
  return { quota, paused: pollInterval(kind, quota) === false };
}
