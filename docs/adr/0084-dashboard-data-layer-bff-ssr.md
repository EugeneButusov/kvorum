# ADR-084 — Dashboard data layer: typed client, same-origin BFF, SSR & polling

- **Status**: Accepted
- **Date**: 2026-07-09
- **Spec sections affected**: 4.4, 4.9, 6.1, 6.3, 6.16, 7.2, 10.9
- **Related**: DR-001, ADR-035 (adaptive polling), ADR-077 (design system)

## Context

The dashboard binds to the M4 read API (OpenAPI 3.1, `docs/openapi.json`): entity and
analytical endpoints, all cursor-paginated, ETagged, and rate-limited. Two constraints
shape the data layer:

- **DR-001** — the dashboard is fully browseable with no login. The API **will** resolve a
  tier from `request.apiKey` once the auth backend lands; **today reads are open** (the
  rate-limit interceptor passes through when `request.apiKey` is undefined, and nothing sets
  it yet). When enforcement arrives, a key must be attached to reads **server-side**, without
  ever shipping one to the browser — so the data layer needs a server seam for that key now.
- **ADR-035 / §6.16** — polling on active data must adapt to remaining rate-limit quota
  (`RateLimit-Remaining`, already emitted by the API alongside `-Limit`/`-Reset`), over
  `If-None-Match`/`304`, with an honest freshness indicator and a paused state at low quota.

The dashboard is a Next.js 16 App Router app; nothing about the client was decided before
this ADR. The locked M6 stack names **TanStack Query** as the server-state owner.

## Decision

### 1. Typed client — `openapi-typescript` + `openapi-fetch`

Types are generated from `docs/openapi.json` with **openapi-typescript** into
`src/lib/api/schema.d.ts` (a `pnpm --filter dashboard gen:api` script; the output is
committed and regenerated when the contract changes). Requests go through **openapi-fetch**,
a ~6 kB typed wrapper that consumes those types — full path/param/response typing, no
generated client code to review, no heavy codegen framework. This fits the lean-bundle,
Lighthouse-driven ethos (ADR-085 makes the same call for charts). Rejected: **orval** /
`@hey-api/openapi-ts` (generate a large hooks client — more surface, heavier); a hand-rolled
untyped `fetch` (loses contract typing).

### 2. Same-origin BFF — a Next catch-all route handler

A single route handler at `app/api/kv/[...path]/route.ts` proxies **GET** reads to the API
(base URL from server-only env `BACKEND_API_URL` — never `NEXT_PUBLIC_*`). It passes
`If-None-Match` through and returns the upstream `ETag`, `Cache-Control`, `RateLimit-*`,
`Retry-After` headers and status (including `304`) verbatim. The browser calls same-origin
`/api/kv/v1/…` and **never talks to the API directly**, reconciling DR-001 with the
(eventually) token-gated API. Reads are open today, so the handler attaches no key; it is the
**seam** where a server-side key is injected once the auth backend enforces one — the browser
still never holds it. When sessions land (M6-2/M6-6) that seam attaches the session-provisioned
`kv_dashboard_*` key (ADR-035) for logged-in developers, with no change to callers. Only GET is
proxied in M6 (reads); the developer key-CRUD mutations arrive with the auth backend.

### 3. SSR-vs-client policy

- **Server components** fetch directly from the API (bypassing the BFF hop), for the
  SEO-relevant pages that must SSR (proposal detail, lists, DAO landing, forum, actor —
  §10.9 / AC #5); the server-side key attaches here too once enforcement lands.
- **Client components** fetch through the BFF via TanStack Query, for interactive and
  **polled** sections (tally, activity feed, developer dashboard).

A single `createApiClient({ baseUrl, apiKey? })` backs both: server callers pass the API URL
(and, once enforcement lands, the key); browser callers point at `/api/kv`. `apiKey` is
optional — the injection seam — and unused while reads are open.

### 4. ETag / conditional-GET plumbing

TanStack Query holds the cached body and its ETag; the client sends `If-None-Match` on
refetch; a `304` resolves to the cached body with **no state change and no re-render**. The
BFF is a transparent pass-through for the conditional-GET contract the API already
implements (`etag.interceptor.ts`).

### 5. Polling — fixed intervals now, ADR-035 quota backoff deferred

Fixed cadences per **§6.16** (`POLL_INTERVAL_MS`): tally 10 s while active, homepage
active-proposals + activity feed 30 s. These are wired as TanStack Query's
`refetchInterval`. Freshness derives from the query's `dataUpdatedAt` (the `<Fresh>`
component); failures surface a "retrying" state (§6.16), never a silent stale.

The **ADR-035 quota-adaptive backoff** (back off as `RateLimit-Remaining` drops — ≥25% →
10 s/30 s, 10–25% → 2×, <10% → paused with "Live updates paused") is **deferred**, because
the API only emits `RateLimit-*` headers once it resolves a key/tier, and reads are keyless
today (see §2). Adding the backoff now would be dead machinery reading headers that never
arrive. It lands with the auth backend that provides the header source — re-introduced as a
`refetchInterval` function over the fixed base, so the §6.16 cadences here are the base it
backs off from. This is a deliberate deferral of ADR-035's "client lands in M6-1.5" to
"lands when the quota signal exists," recorded here rather than shipped dormant.

## Alternatives considered

- **Public keyless-by-IP tier + browser calls the API directly.** Rejected: the API has no
  anonymous tier, it would leak rate-limit fairness across all anonymous users of a shared
  IP, and it complicates the ADR-035 backoff signal. The BFF is the clean reconciliation.
- **SWR instead of TanStack Query.** Equivalent for fetching; TanStack Query is the locked
  choice and its `refetchInterval` (including as a function) is a direct fit for §6.16 polling
  and the later ADR-035 backoff.
- **Generate a full client (orval).** See §1.

## Consequences

- The browser never talks to the API directly; all reads are same-origin. CORS is a non-issue,
  and the browser never holds a key once one exists.
- Page epics bind to `createApiClient` + typed hooks + `POLL_INTERVAL_MS`; the contract is
  typed end to end and regenerated from `openapi.json`.
- The env surface gains one server-only var (`BACKEND_API_URL`), documented in `.env.example`.
  Reads are open today; when the auth backend enforces keys, the server-side / session key is
  attached at the BFF seam (secrets via the vault, ADR-028) — no caller churn.
- Polling runs at the fixed §6.16 cadences now; the ADR-035 quota backoff is deferred until
  the API emits `RateLimit-*` headers (the auth backend supplies the quota signal), then slots
  in over the same base intervals — no caller churn.
- Verified in M6-1.5 with synthetic tests (the BFF proxy / header pass-through / `304`); the
  live end-to-end lights up as pages bind real data.
