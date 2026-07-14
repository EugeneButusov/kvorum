# M6 — Frontend implementation · Retrospective

**Milestone:** M6 — Frontend implementation (GitHub #8)
**Scope:** Build the Next.js dashboard (`apps/dashboard`) against the M5.5 designs — from a ~5% stub to
the full public dashboard plus the authenticated developer section.
**Outcome:** Delivered. 7 epics (#457–#463), ~30 PRs (#492–#525 + this one).

## What shipped

| Epic | Area                      | Highlights                                                                                      |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| M6-1 | Design system + shell     | Tokens, ~20 primitives, TopNav/footer/search, Vitest+RTL harness                                |
| M6-2 | Auth/session/keys backend | SIWE (greenfield), Redis sessions, CSRF, API-key CRUD, account deletion                         |
| M6-3 | Proposal surface          | Detail page, server tally aggregate, tally polling, lists, homepage                             |
| M6-4 | Analytics                 | Bespoke-SVG charts (ADR-085), DAO health, DAO landing, delegate scorecard                       |
| M6-5 | Actor + forum             | Cross-DAO actor page, forum thread page (+ its backend read endpoint)                           |
| M6-6 | Auth + developer pages    | SIWE flow (6 states), auth pages, developer dashboard, protected routing                        |
| M6-7 | Hardening                 | Error/edge pages, a11y (axe + AA contrast), SSR/SEO + blocking Lighthouse gate, this smoke pass |

## Key decisions (and their ADRs)

- **SIWE-only auth for M6** — email/password + verification + forgot/reset are a fast-follow (Resend,
  ADR-083, not wired).
- **Same-origin BFF** (ADR-084) — the browser never holds an API key or talks to the API directly; the
  server relays reads and forwards the session-cookie/CSRF contract for auth.
- **Bespoke inline-SVG charts** (ADR-085) — no charting library; every chart has a "View as table"
  accessible alternative.
- **Headless wagmi + viem + siwe** — custom shadcn `Dialog` UI, no RainbowKit/Reown.
- **Graceful-degradation posture** (ADR-086) — honest "coming soon" / "temporarily unavailable" states
  instead of fake data or crashes; the UI upgrades in place as data/features land.
- Stack: Next 16 App Router · TanStack Query · TanStack Table · react-markdown · Playwright · Vitest ·
  Plausible.

## What went well

- **The design system paid off.** Semantic HTML, `:focus-visible`, colour-never-sole-carrier, and
  decorative `alt=""` were right from M6-1, so the a11y pass (M6-7.2) was mostly _locking it in_ with
  axe — only contrast needed real fixes.
- **Consistent shipping cadence** — one task → one PR → four gates → browser-verify → CI, ~30 times.
- **BFF + graceful null** kept the app coherent despite AI (M5) and some data being absent.

## What was harder — lessons

- **The read-auth gap surfaced late.** The dashboard's SSR reads carry no credential, but the M6-2 auth
  backend now enforces auth — so against a live API, public-page server reads would 401. Narrowed in
  M6-7.3 (proposal detail no longer 500s), but the real fix (per-IP-keyless-reads on the forwarded client
  IP) is deferred backend work. _Lesson: validate the FE↔API auth contract end-to-end early, not at
  hardening time._
- **`openapi-fetch` doesn't catch a rejected `fetch`.** ECONNREFUSED throws rather than returning
  `{error}`, so every SSR fetch needed a try/catch to avoid a 500. _Lesson: wrap SSR data loaders
  defensively from the first page, not reactively._
- **Auth endpoints deliberately stayed out of the OpenAPI contract**, so the dashboard hand-typed the
  ~9 session/keys/account calls. Acceptable, but a source of drift to watch.
- **Framework churn**: Next 16 renamed the `middleware` convention to `proxy`; `vitest-axe`'s
  `extend-expect` is a no-op under Vitest (register the matcher manually); value imports of `@/lib/*` in
  tests must be relative.

## Deferred / follow-ups

- **Per-IP-keyless-reads** (backend) — the load-bearing fix for public-page reads against an
  auth-enforcing API.
- **AI panels** — light up when M5 ships (graceful-null today).
- **`/health` degraded payload** — activates the wired-but-dormant `DegradedBar`.
- **Email auth** — password path + verification + forgot/reset + Resend (ADR-083).
- **Usage analytics** — belongs in ClickHouse; the §6.13 usage view is deferred until enforcement lands.
- **Mobile analytical pages** — health dashboard + delegation flow stay desktop-first (KNOWN-019); v1.1.
- **Broader DAO coverage** — Uniswap (and beyond) once indexed.

## Acceptance

All epic acceptance criteria met. The M6-7.4 Playwright smoke suite exercises the primary flows
(homepage → nav → proposal detail; auth pages + email toggle; protected-route redirect; context-aware
404s) against a production build; data-heavy assertions are covered by the Vitest component suites.
Full end-to-end against seeded M4 data awaits a backend in CI.
