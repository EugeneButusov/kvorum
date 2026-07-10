# ADR-084 — Dashboard data layer: typed client, same-origin BFF, SSR & adaptive polling

- **Status**: Accepted
- **Date**: 2026-07-09
- **Spec sections affected**: 4.4, 4.9, 6.1, 6.3, 6.16, 7.2, 10.9
- **Related**: DR-001, ADR-035 (adaptive polling), ADR-077 (design system)

## Context

The dashboard binds to the M4 read API (OpenAPI 3.1, `docs/openapi.json`): entity and
analytical endpoints, all cursor-paginated, ETagged, and rate-limited. Two constraints
shape the data layer:

- **DR-001** — the dashboard is fully browseable with no login, yet **every API request
  needs an API key** (the API resolves a tier from `request.apiKey`; there is no anonymous
  read tier). A key must therefore be attached to reads without ever shipping one to the
  browser.
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

A single route handler at `app/api/kv/[...path]/route.ts` proxies **GET** reads to the API,
injecting `Authorization: Bearer <server-side key>` from server-only env
(`KVORUM_API_URL`, `KVORUM_API_KEY` — never `NEXT_PUBLIC_*`). It passes `If-None-Match`
through and returns the upstream `ETag`, `Cache-Control`, `RateLimit-*`, `Retry-After`
headers and status (including `304`) verbatim. The browser calls same-origin `/api/kv/v1/…`
and **never holds a key**, reconciling DR-001 with the token-gated API. Only GET is proxied
in M6 (reads); the developer key-CRUD mutations arrive with the auth backend and use the
session cookie. When sessions land (M6-2/M6-6) the BFF upgrades from the env key to the
session-provisioned `kv_dashboard_*` key (ADR-035) with no change to callers.

### 3. SSR-vs-client policy

- **Server components** fetch directly from the API (bypassing the BFF hop) with the
  server-side key, for the SEO-relevant pages that must SSR (proposal detail, lists, DAO
  landing, forum, actor — §10.9 / AC #5).
- **Client components** fetch through the BFF via TanStack Query, for interactive and
  **polled** sections (tally, activity feed, developer dashboard).

A single `createApiClient({ baseUrl, apiKey? })` backs both: server callers pass the API
URL + key; browser callers point at `/api/kv` with no key.

### 4. ETag / conditional-GET plumbing

TanStack Query holds the cached body and its ETag; the client sends `If-None-Match` on
refetch; a `304` resolves to the cached body with **no state change and no re-render**. The
BFF is a transparent pass-through for the conditional-GET contract the API already
implements (`etag.interceptor.ts`).

### 5. Adaptive polling (the ADR-035 client)

An openapi-fetch response middleware records the latest `RateLimit-Limit`/`-Remaining`/
`-Reset` into a small external store (`useSyncExternalStore`). A pure
`pollInterval(kind, quota)` maps remaining quota to an interval per ADR-035:

| Remaining / limit | `tally` | `feed` |
| ----------------- | ------- | ------ |
| ≥ 25%             | 10 s    | 30 s   |
| 10–25%            | 20 s    | 60 s   |
| < 10%             | paused  | paused |

It is wired as TanStack Query's `refetchInterval` (returning `false` pauses). Freshness
derives from the query's `dataUpdatedAt` (the `<Fresh>` component); the paused state reads
"Live updates paused — refresh to retry" (§6.3); failures surface a "retrying" state, not a
silent stale. Quota is tracked per tab; the privileged tier's headroom (ADR-035) makes
cross-tab coordination unnecessary.

## Alternatives considered

- **Public keyless-by-IP tier + browser calls the API directly.** Rejected: the API has no
  anonymous tier, it would leak rate-limit fairness across all anonymous users of a shared
  IP, and it complicates the ADR-035 backoff signal. The BFF is the clean reconciliation.
- **SWR instead of TanStack Query.** Equivalent for fetching; TanStack Query is the locked
  choice and its `refetchInterval`-as-function is a direct fit for adaptive polling.
- **Generate a full client (orval).** See §1.

## Consequences

- The browser never holds an API key; all reads are same-origin. CORS is a non-issue.
- Page epics bind to `createApiClient` + typed hooks + `pollInterval`; the contract is typed
  end to end and regenerated from `openapi.json`.
- The env surface gains two server-only vars (`KVORUM_API_URL`, `KVORUM_API_KEY`);
  documented in `.env.example`. M7 wires the real key/secret via the vault (ADR-028).
- The BFF is the single seam where the env key becomes the session `kv_dashboard_*` key when
  auth ships — no caller churn.
- Verified in M6-1.5 with synthetic tests (the `pollInterval` tiers, the BFF proxy/header
  pass-through); the live end-to-end lights up as pages bind real data.
