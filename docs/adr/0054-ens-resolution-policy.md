# ADR-054 - ENS resolution policy

- **Status**: Accepted
- **Date**: 2026-05-24
- **Related**: ADR-033
- **Issue**: #176

## Context

Epic N introduces actor-level ENS display names. ENS enrichment is best-effort metadata: API routing and identity are always keyed by EVM address, not ENS name. We need a deterministic refresh policy that balances staleness and RPC cost.

## Decision

1. Refresh cadence is a daily cron at `03:00 UTC`.
2. Refresh eligibility TTL is `7 days`: actors with `updated_at < now() - INTERVAL '7 days'` are in scope.
3. ENS calls are batched with `multicall3`, `50` addresses per call.
4. Reverse name is accepted only when forward-check passes: `getEnsAddress(reverseName) === address`.
5. Forward-check mismatch means no write: keep `display_name` as `NULL`.
6. RPC failures are transient operational errors: log and retry on the next scheduled cycle.
7. ENS refresh has no DLQ path in N2/N3 scope; it remains best-effort.
8. Operator override command is `admin-cli ens refresh-all`.

## Consequences

- ENS data can be stale for up to 7 days by policy.
- Reverse records that fail forward-check are intentionally ignored.
- Routine refreshes stay within predictable RPC envelopes.
- Prolonged ENS provider outages defer updates but do not block API availability.

## Amendments

### 2026-05-24 — N3 Universal Resolver clarification

The N2 decision wording described reverse and forward checks as two logical steps. N3 implements the same anti-spoofing semantics through ENS Universal Resolver `reverse(bytes)` wrapped by Multicall3 `tryAggregate(false, ...)`:

1. One multicall RPC contains up to 50 resolver calls.
2. Each subcall returns `name` and `resolvedAddress`.
3. A result is `resolved` only when `resolvedAddress.toLowerCase() === inputAddress.toLowerCase()`.

Operationally this reduces RPC round-trips while preserving the original policy: forward-check mismatch means no write, and per-address failures remain isolated.
