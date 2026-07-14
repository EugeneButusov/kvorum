# ADR-086 — Design adjustments where M6 meets real (and missing) data

- **Status**: Accepted
- **Date**: 2026-07-14
- **Spec sections affected**: 6.1, 6.3, 6.7, 6.11, 6.14, 6.15, 6.19
- **Related**: M6 frontend (all epics), ADR-077 (design system), ADR-082/084 (auth/BFF), ADR-085 (charts), KNOWN-019

## Context

The M5.5 design bundle (`docs/design/`) mocks the dashboard against a fully-populated, fully-featured
product: every AI panel synthesised, every chart dense with data, every page served by a live API. M6
builds that UI against the **actual** state of the platform at implementation time, which differs in
three ways:

1. **AI features are not shipped.** The AI endpoints land in M5 (milestone still open); `libs/ai` is a
   stub. Proposal summaries, the forum synthesiser, and the calldata-vs-prose mismatch detector have no
   backend yet.
2. **Some designed data has no endpoint.** Usage analytics for the developer dashboard, a rich
   degraded-mode health signal, and a few chart series either don't exist in M4 or were descoped in
   M6-2.
3. **The backend can be unreachable.** SSR reads can fail (a hiccup, or — until the deferred
   per-IP-keyless-reads work lands — an auth-enforcing API with no dashboard credential).

The design's trust posture (§6.1) is explicit: never show stale or fabricated data as if it were real.
So the question is how the UI behaves in each gap.

## Decision

Where the real data or feature is absent, the UI renders an **honest, graceful state** rather than
fake data, a placeholder chart, or a blank — and never a crash. Specifically:

- **AI panels render a fenced "coming soon" state** that names the feature and points at the underlying
  raw data (raw proposal description, raw forum thread, on-chain actions). They light up automatically
  when M5 ships, with no UI change.
- **Missing-data views state their absence.** The developer dashboard's usage/rate-limit views, and any
  chart without a series, show an explicit empty state, not a zeroed-out mock.
- **Backend-unreachable degrades, never 500s.** Server reads are wrapped so a network failure renders a
  200 "temporarily unavailable" shell (proposal detail) or an empty section, keeping navigation and the
  rest of the page working. A reachable-but-404 still returns a real 404 (context-aware, §6.15).
- **Degraded-mode (§6.15 503) is wired but dormant.** The non-blocking `DegradedBar` polls `/health` and
  activates the moment `/health` carries a degraded payload; today `/health` is liveness-only.
- **SIWE-only auth for M6.** The email/password path (design §6.14) renders a "coming soon" toggle;
  `/forgot-password` + `/reset-password` render the coming-soon state.
- **Coverage reflects reality.** Only Compound, Aave, and Lido are presented as tracked DAOs
  (Uniswap was removed from the nav + 404 coverage copy until it's actually indexed).

One deliberate departure from the design _tokens_ was also required for accessibility:

- **Brand-green contrast (§6.19).** The light-mode `--accent` (#00a86b) failed WCAG AA as link text and
  under white button labels; it was darkened to #00804f (and captions `--ink-3` to #6f6f68). Fills stay
  recognisably the brand green; dark mode already passed and is unchanged.

## Alternatives considered

- **Placeholder / sample data in the empty slots.** Rejected — it violates the §6.1 trust posture and
  risks reading as real governance data.
- **Hide the unfinished surfaces entirely.** Rejected — the fenced "coming soon" states set expectations
  and keep the information architecture stable for when the features land.
- **Return 503/blank on backend-unreachable.** Rejected for the SEO-relevant pages — a 200 graceful shell
  keeps the page crawlable and navigable; a hard error would fail both users and the Lighthouse gate.

## Consequences

- The UI is honest about what is and isn't live, and upgrades in place as M5 (AI), the `/health`
  degraded payload, email auth, per-IP-keyless-reads, and further DAO coverage arrive.
- Mobile treatment of the analytical pages (health dashboard, delegation flow) stays desktop-first per
  KNOWN-019; refined mobile is deferred to v1.1.
- The Lighthouse gate audits these graceful shells in CI (no seeded backend), so it validates SSR/meta/
  shell quality rather than live-data rendering.
