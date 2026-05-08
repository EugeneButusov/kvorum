# ADR-025 — API key hashing uses HMAC-SHA256; passwords use argon2id

- **Status**: Proposed
- **Date**: 2026-05-08
- **Spec sections affected**: 4.3, 7.6

## Context

SPEC §4.3 says API keys are stored as "salted hashes" without specifying the algorithm. SPEC §7.6 specifies "bcrypt with cost factor 12 (or argon2id where the platform supports it)" for password storage. The two cases are conflated in the spec's language but have very different requirements:

- **Passwords** are low-entropy, user-chosen, and verified rarely (login). Slow KDFs (bcrypt, argon2id) are correct because they raise the cost of an offline brute-force attack against a stolen hash table.
- **API keys** are high-entropy (32 url-safe characters from Kvorum's CSPRNG) and verified on *every* request. A bcrypt-cost-12 verification is ~250 ms — a single CPU sustains <4 verifications per second. The free tier alone (60 RPM × hundreds of keys) breaks the API.

Plain `SHA-256(key)` would be fast but vulnerable to rainbow-table lookups if the DB is exfiltrated. The fix is a server-side pepper (a single secret known to the application but not stored with the hash).

## Decision

Two distinct credential-storage algorithms:

**API keys** are stored as `HMAC-SHA256(server_pepper, key)`. Verification is a constant-time comparison (`crypto.timingSafeEqual`) against the stored HMAC. The pepper is a 256-bit secret stored alongside other deployment secrets (per ADR-028) and is not specific to any individual key. There is no per-key salt — the high entropy of the key itself plus the global pepper makes per-key salting unnecessary and prevents the salt column from leaking the key count.

**User passwords** are stored as argon2id with parameters `m=64MiB, t=3, p=1` (OWASP-recommended baseline as of 2025). A per-user salt is generated at registration. SPEC §7.6's bcrypt fallback is removed; argon2id is the v1 algorithm.

Pepper rotation is a deployment event: a new pepper is provisioned, all keys are re-hashed in a single transaction (the plaintext key is not available, so re-hashing happens on next use — the API verifies against the new pepper, falling back to the old pepper during a configured grace window). Argon2id parameters are stored alongside each hash (the standard PHC string format does this automatically) so future tightening doesn't break existing accounts.

## Alternatives considered

- **Bcrypt for both.** Crashes API throughput; inconsistent with §4.4's rate limits, which assume cheap key validation.
- **Plain SHA-256 for API keys (no pepper).** Susceptible to rainbow-table lookup of the key column if the DB is exfiltrated. The pepper is a small mitigation that costs nothing.
- **Per-key salt for API keys.** Adds a column, exposes the key count, and provides no security benefit over a global pepper for high-entropy keys.
- **Argon2id for API keys.** Same throughput problem as bcrypt at any reasonable parameter set.

## Consequences

- API throughput is not bottlenecked on key verification (single-digit microseconds per check, fully RAM-resident).
- Pepper rotation is a documented deployment runbook step (ADR-028's vault holds both peppers during the grace window).
- A key compromise does not propagate beyond the affected key — keys are rotated and revoked individually (§4.3 already supports this).
- §7.6's text gains an explicit cross-reference to this ADR; the bcrypt fallback line is replaced with the argon2id specification.
- Implementation notes: Node.js `crypto.createHmac('sha256', pepper).update(key).digest()` for HMAC; the `argon2` npm package (native bindings) for argon2id. Both are mature and audited.
