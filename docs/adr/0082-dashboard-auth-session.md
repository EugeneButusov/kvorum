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
  IP comes from `req.ip`, resolved from `X-Forwarded-For` only for connections from an allowlisted
  proxy (`trust proxy` = IP/CIDR list), so a direct client can't spoof it.
- **Endpoints:** `POST /v1/auth/siwe/nonce`, `POST /v1/auth/siwe/verify`, `GET /v1/auth/session`,
  `POST /v1/auth/logout`, `POST /v1/auth/logout-all`. Excluded from the committed OpenAPI until the
  unified auth+keys regeneration (M6-2.4).

### Developer keys, rotation grace & usage

- **Rotation grace.** A nullable `api_key.expires_at` column: a key is active when
  `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`. Rotation mints a new key and
  sets the old key's `expires_at = now() + grace` (≤24h, §4.3), so in-flight callers can swap over;
  immediate revoke still uses `revoked_at`.
- **API key CRUD** (`/v1/keys`, session-authenticated — the developer dashboard's self-service
  surface): create (full `kv_live_` key shown once), list (prefix + last-4 + status), rotate (grace),
  revoke. Ownership-scoped; any dashboard-tier (internal) key is hidden.
- **Usage analytics deferred.** §6.13's usage view (30-day request volume by endpoint family, quota
  progress) is **not built here**: it has no data until key enforcement is on, and per-request usage
  analytics belongs in ClickHouse (the existing analytics store), not a bespoke Redis-counter
  subsystem. Deferred until enforcement lands and its home is decided.

### Dashboard → API authentication (supersedes ADR-035's per-session key)

ADR-035 proposed a per-session `kv_dashboard_` key provisioned on login. **We drop that.** The
dashboard is first-party UI over public, read-only data — not a third-party API consumer — so it
needs no developer-style credential:

- **No per-session key, no privileged mint.** A per-session bearer key is _net-negative_ security:
  it works directly against the API from anywhere (bypassing the session cookie's HttpOnly /
  SameSite=Strict / CSRF / BFF protections), and minting one per session multiplies that surface.
- **Reads stay keyless; abuse is bounded per-IP** at the edge where the real client IP is visible.
  Because the browser → BFF → API path makes every dashboard request arrive from the BFF's
  connection, the limit MUST key on the **forwarded** client IP (`X-Forwarded-For`), trusted **only**
  from an allowlisted proxy (`trust proxy` = IP/CIDR list) so a direct client can't spoof it.
- If the public API ever hard-enforces "no anonymous" (§4.3), first-party/internal traffic is
  exempted at the edge rather than issued a credential. (Per-IP limiting on the read path is M6-6.)

### Account deletion (KNOWN-020)

- `DELETE /v1/account` (session-authenticated, CSRF-enforced) permanently deletes the caller's own
  account: a PG transaction deletes the user's `api_key` rows (the FK is `onDelete('restrict')`, so
  keys go first — deleting them revokes them) then the `users` row, followed by
  `destroyAllForUser` (all sessions) and cookie clearing.
- **Recovery-email hash deferred.** KNOWN-020's "hash the email for re-registration prevention" lands
  with the email/password fast-follow, where the signup check that consumes the hash also lives —
  there is no consumer yet (SIWE re-registration is wallet-keyed, not email-keyed).

### The auth/keys/account surface stays out of the public OpenAPI

`docs/openapi.json` is the **public read-API contract** (bearer-key auth, for third-party
developers, and the source for the dashboard's `openapi-typescript` types). The auth / keys / account
endpoints are **session/cookie-authed, dashboard-internal** — a different audience and security
model — so they keep `@ApiExcludeController()` and are absent from the committed spec. The dashboard
types those calls in M6-6 (hand-written, or a separate internal spec); mixing them into the public
contract is deliberately avoided.

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
- **Deferred beyond M6-2:** the recovery-email hash + its signup check (email/password fast-follow);
  per-IP limiting on the read path + the first-party "no anonymous" exemption (M6-6); usage analytics
  (deferred, belongs in ClickHouse). The per-session `kv_dashboard_*` key was dropped entirely
  (supersedes ADR-035 — see "Dashboard → API authentication").
