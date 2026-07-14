// Base polling cadences (SPEC §6.16): tally 10s while active, homepage active-proposals
// + activity feed 30s. The quota-adaptive backoff on top of these lives in quota.ts.
export const POLL_INTERVAL_MS = {
  tally: 10_000,
  feed: 30_000,
} as const;

export type PollKind = keyof typeof POLL_INTERVAL_MS;
