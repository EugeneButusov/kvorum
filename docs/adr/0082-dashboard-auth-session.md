# ADR-082 — Dashboard auth & session model

- **Status**: Accepted
- **Date**: 2026-07-10
- **Spec sections affected**: 4.3, 4.4, 6.13, 6.14
- **Related**: DR-001, ADR-025 (credential hashing), ADR-028 (secrets vault), ADR-035 (dashboard tier), ADR-083 (email provider — fast-follow), ADR-084 (dashboard data layer)

## Context

SPEC §6.13 (developer dashboard) and §6.14 (auth) assume an auth/session/keys backend that
does not exist. The read API authenticates only via bearer API keys (`ApiKeyGuard`, a global
`APP_GUARD`); there is no cookie session, no wallet login, and no user-facing key management.

The M4 substrate that _does_ exist: the `users` / `api_key` tables, the `libs/auth` crypto
primitives (HMAC key hashing, pepper rotation), the `UserRepository` / `ApiKeyRepository`, and
the `admin-cli keys` CRUD. Redis is already a dependency (the rate limiter uses `ioredis`).

M6 is **locked to SIWE-only** (wallet login). Email/password — argon2id credentials, email
verification, forgot/reset — and the Resend integration (ADR-083) are a **post-M6 fast-follow**
and must slot in **additively**, without reworking the schema or the session model decided here.

This ADR fixes the session substrate (this task, M6-2.1). SIWE message/verify/nonce mechanics
(M6-2.2), developer key CRUD + `kv_dashboard_*` provisioning (M6-2.3), and account deletion
(M6-2.4) build on it and are detailed in their own tasks.

## Decision

### Sessions

- **Redis-only, opaque-id sessions.** On login the server mints a 256-bit random session id
  (`sess:<id>` → `{ userId, csrfToken, createdAt, lastSeenAt }` JSON) with a **30-day TTL**.
  Postgres stays the identity store of record; sessions are ephemeral and never persisted there.
  The id is unguessable and server-looked-up, so the cookie is **not signed** (a signature adds
  nothing over unguessability + Redis lookup).
- **Sliding expiry.** Activity refreshes the TTL (idle-timeout semantics, not an absolute cap),
  throttled to at most one write/minute per session so an active session costs ~1 Redis write/min.
- **Sign out everywhere.** A per-user index (`user_sessions:<userId>` set) lets one call revoke
  every session for a user. Benign race: a session created concurrently with the revoke may
  survive; acceptable for v1.
- **Dedicated Redis connection**, separate from the rate limiter's, with `lazyConnect: true` —
  mandatory so `generate-openapi.ts` and AppModule-boot unit tests (which set `REDIS_URL` but run
  no Redis) don't hang/error on construction.

### Cookies & CSRF

- **`kv_session`** — `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=30d`. JS must never read it.
- **`kv_csrf`** — the same-value CSRF token, **not** HttpOnly (JS reads it to echo in a header).
- **Double-submit CSRF** on mutating verbs (POST/PUT/PATCH/DELETE): the `X-CSRF-Token` header must
  equal both the `kv_csrf` cookie and the session record's token. GET/HEAD are exempt.
- `SameSite=Strict` is the primary CSRF defence; double-submit is defence-in-depth (and keeps us
  safe if SameSite is ever relaxed). Tradeoff accepted per §6.14: the session cookie is not sent on
  inbound cross-site top-level navigation (an emailed dashboard link renders logged-out until the
  next same-site nav) — fine for a developer dashboard.

### Guards

- **`SessionGuard`** authenticates cookie requests: validates the session, re-loads the `User`
  (rejecting `banned_at`), attaches `request.user` + `request.session`, enforces CSRF on mutating
  verbs, and slides the TTL. `@SessionUser()` exposes the user to handlers.
- **The two auth paths are independent.** The global `ApiKeyGuard` stays as-is. Session routes opt
  out of it with `@Public()` and opt into cookie auth with `@UseGuards(SessionGuard)`. No route
  mixes bearer-key and cookie auth.
- **Redis-down → 503, never 401.** A session-store outage surfaces `503 service-unavailable`; an
  outage must not read as "logged out" (mirrors the rate limiter's Redis-down stance).

### SIWE (wallet login)

- **Flow:** `POST /v1/auth/siwe/nonce` issues a server-generated nonce (stored in Redis, 10-min TTL);
  the client puts it in the EIP-4361 message the wallet signs; `POST /v1/auth/siwe/verify` validates
  and establishes a session.
- **Replay protection:** the nonce is **single-use**, consumed atomically with `GETDEL` on verify —
  a signature can never be replayed. The signature is checked _before_ the nonce is spent, so a bad
  signature doesn't burn a nonce (nonce spend is DoS-bounded by the per-IP limit instead).
- **Domain binding:** the EIP-4361 `domain` is verified against `SIWE_DOMAIN` (explicit config), not
  the request `Host` header (spoofable). Verified with `siwe` v3 + the existing `ethers` v6.
- **Identity:** verify upserts the user by wallet address (`upsertByWalletAddress`), then mints a
  session. An optional recovery email may be captured (not verification-gated for SIWE, per §6.14);
  a collision with another account returns 409.
- **Per-IP rate-limiting:** the auth endpoints carry an `auth_ip` tier (tight per-IP budget) via a
  guard reusing the sliding-window limiter — blunts enumeration/brute-forcing (§6.14, §7.3). Client
  IP comes from `req.ip`, so Express `trust proxy` is configured to the known proxy hop count.
- **Endpoints:** `POST /v1/auth/siwe/nonce`, `POST /v1/auth/siwe/verify`, `GET /v1/auth/session`,
  `POST /v1/auth/logout`, `POST /v1/auth/logout-all`. Excluded from the committed OpenAPI until the
  unified auth+keys regeneration (M6-2.4).

### Developer keys, rotation grace & usage

- **Key prefixes.** `libs/auth` recognises a set of prefixes (`kv_live_` public, `kv_dashboard_`
  privileged); §4.3 reserves extra prefixes for tier/scope without breaking consumers. The guard
  looks up by full-key hash, so it's prefix-agnostic.
- **Rotation grace.** A nullable `api_key.expires_at` column: a key is active when
  `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`. Rotation mints a new key and
  sets the old key's `expires_at = now() + grace` (≤24h, §4.3), so in-flight callers can swap over;
  immediate revoke still uses `revoked_at`.
- **Key CRUD** (`/v1/developer/keys`, session-authenticated): create (full key shown once), list
  (prefix + last-4 + month request count + status), rotate (grace), revoke. Ownership-scoped; the
  `kv_dashboard_` key is internal and hidden from this surface.
- **Usage tracking.** The rate-limit sliding-window counters only hold the current window, so usage
  is aggregated separately: an interceptor increments per-key/per-family daily counters (+ a month
  total) in Redis on each authenticated request; the usage endpoint returns the trailing-30-day
  breakdown by endpoint family + current-month quota status (§6.13).
- **Session-scoped `kv_dashboard_` key (ADR-035).** Provisioned on session creation (SIWE verify),
  revoked on logout / logout-all. Its plaintext lives in the server-side Redis session record (never
  sent to the browser) for the same-origin BFF to attach (ADR-084, M6-6) — reconciling ADR-035's
  "key provisioned at session creation" with ADR-084's "browser never holds a key". A safety-net
  `expires_at` equal to the session lifetime prevents a TTL-lapsed session from leaving a live key.

### Identity schema (additive)

- `users.wallet_address` — nullable, `UNIQUE`, lowercased (a CHECK enforces it); the SIWE anchor.
- `users.email` and `users.display_name` relax to **nullable** (wallet accounts carry neither).
- A CHECK guarantees every row keeps at least one identity anchor: `email IS NOT NULL OR
wallet_address IS NOT NULL`.
- The email/password fast-follow adds `password_hash`, `email_verified_at`, and reset-token columns
  **on top of** this shape — no rework.

## Consequences

- The dashboard gets a real, testable session backend: SIWE (M6-2.2) upserts a user by wallet and
  mints a session; the developer dashboard (M6-2.3) authenticates key CRUD via the cookie.
- Security-sensitive paths (CSRF, session revocation, Redis-down behaviour) are covered by
  deterministic unit + e2e tests rather than manual checks.
- **Deferred to the fast-follow (not built here):** argon2id passwords + breach/length checks,
  email verification, forgot/reset token lifecycle, and Resend (ADR-083). The `/forgot-password` +
  `/reset-password` pages render an "email accounts coming soon" state until then.
- **Out of scope of this ADR (later M6-2 tasks):** SIWE nonce/replay + per-IP auth rate-limiting,
  `kv_dashboard_*` key provisioning + usage endpoints, account deletion + email-hash (KNOWN-020),
  and the OpenAPI regeneration.
