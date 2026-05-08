# ADR-035 — Dashboard polling adapts to remaining rate-limit quota

- **Status**: Proposed
- **Date**: 2026-05-08
- **Spec sections affected**: 4.4, 6.16
- **Related**: DR-001, DR-009

## Context

SPEC §4.4 sets the authenticated free tier at 60 requests/minute, 10,000 requests/day. SPEC §6.16 specifies dashboard polling at 10-second intervals on active proposal tally and 30-second intervals on the homepage's active proposals + activity feed. SPEC §4.9 commits to ETag-based conditional requests so polling on unchanged resources returns 304 with negligible bandwidth.

The 304 helps bandwidth but does _not_ avoid the rate-limit budget — the request still counts against the per-minute quota. A user with two browser tabs open on active-proposal detail pages plus the homepage burns 6 + 6 + 2 = 14 requests/minute, which is fine; ten tabs cross the 60-RPM ceiling and the user starts seeing 429 responses on their own dashboard.

DR-009 already deferred WebSocket / SSE to v1.1, so push delivery is not the v1 fallback. Two reasonable v1 mitigations exist:

1. **Privileged dashboard tier.** The dashboard's own client uses an API key class (`kv_dashboard_*`) with higher per-IP-bound limits, separate from the public free tier developers use.
2. **Adaptive polling.** The client backs off as remaining quota drops; visible "live updates paused" state when quota is exhausted rather than silent 429 errors.

Both are useful. Doing only the privileged tier hides quota exhaustion from power users. Doing only adaptive polling leaves multi-tab users self-rate-limiting unnecessarily.

## Decision

Both mitigations ship.

**Privileged dashboard tier.** A new tier `dashboard` is added to the `tier` column already anticipated in §4.4. Dashboard sessions provision a `kv_dashboard_*` key on session creation (HttpOnly cookie carries the key; the key is not exposed to the JS layer beyond the request interceptor). Dashboard tier limits are 240 RPM / 50,000/day — four times the public free tier, sufficient for several open tabs without saturation. The keys are session-scoped: revoked when the session ends.

This tier addition is non-breaking — §4.4 already commits to "the architecture supports this via a `tier` column on the API key; no breaking changes are required to add it." The public `Authenticated (free)` tier is unchanged.

**Adaptive polling client.** The dashboard's polling client tracks `RateLimit-Remaining` (already returned per §4.4) and adjusts intervals:

| Remaining quota | Tally polling | Activity feed polling |
| --------------- | ------------- | --------------------- |
| ≥ 25%           | 10 s          | 30 s                  |
| 10–25%          | 20 s          | 60 s                  |
| < 10%           | paused        | paused                |

When polling is paused, the freshness indicator (§6.3) reads "Live updates paused — refresh to retry" rather than silently going stale. On the next reset window (per `RateLimit-Reset`), polling resumes automatically.

Quota tracking is per-tab; tabs do not coordinate. The privileged tier's higher ceiling makes coordination unnecessary — pathological multi-tab usage degrades gracefully rather than failing.

## Alternatives considered

- **Always poll at 30 seconds.** Simpler but less responsive on active proposals. The 10-second interval was chosen for tally responsiveness; degrading it across the board is a worse user experience.
- **Pin dashboard client to public tier.** Predictable abuse vector — a user opens 11 tabs and self-rate-limits. The tier system §4.4 already anticipates exists for exactly this case.
- **Use SSE / WebSocket.** Deferred to v1.1 by DR-009. Reopening that decision for polling-cost reasons is the wrong tradeoff at v1 scale.
- **Coordinate polling across tabs via BroadcastChannel.** Possible but reintroduces complexity for limited benefit. The privileged tier's headroom makes pathological cases survivable without coordination.

## Consequences

- Multi-tab users on the dashboard do not self-rate-limit under any realistic usage pattern.
- Public API consumers see no change: the public free tier and its rate-limit headers behave exactly as §4.4 specifies.
- Quota exhaustion is communicated honestly via the freshness indicator, consistent with the §6.1 trust posture ("never silently stale").
- The `tier` column on API keys gains a third value (`dashboard`), in addition to `anonymous` (rejected) and `authenticated_free`. Future paid tiers slot in alongside.
- Provisioning a `kv_dashboard_*` key on session creation is one row in `api_keys` per active session; revoked when the session ends. Volume is bounded by §7.7's "~500 concurrent dashboard sessions at peak" estimate — trivial.
- The dashboard's API client is implemented as a single fetch wrapper with quota tracking and adaptive interval management; ~150 lines of code.
