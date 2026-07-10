// Fixed polling cadences (SPEC §6.16): tally 10s while active, homepage active-proposals
// + activity feed 30s. The ADR-035 quota-adaptive backoff is deferred until the API emits
// RateLimit-* headers — which only happens once the auth backend resolves a key/tier.
export const POLL_INTERVAL_MS = {
  tally: 10_000,
  feed: 30_000,
} as const;

export type PollKind = keyof typeof POLL_INTERVAL_MS;
