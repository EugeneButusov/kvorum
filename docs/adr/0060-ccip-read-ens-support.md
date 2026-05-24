# ADR-060 - CCIP-Read support for ENS resolution

- **Status**: Proposed
- **Date**: 2026-05-24
- **Related**: ADR-054
- **Issue**: #177

## Context

N3 resolves ENS names through Multicall3 + ENS Universal Resolver. Some names rely on CCIP-Read (`OffchainLookup`) and cannot be resolved via this multicall-only path. Those currently land in the generic `error` outcome.

## Decision

Defer CCIP-Read fallback implementation to M3+.

N3 keeps the resolver path simple and deterministic:

- multicall batch only
- no offchain HTTP callback execution
- no extra retry/DLQ surface for ENS refresh

## Consequences

- Certain ENS namespaces (for example some `*.cb.id`) may stay unresolved in N3.
- Runbook and operator expectations must treat this as known behavior, not a regression.
- A future ADR revision (or superseding ADR) should define:

1. fallback strategy after `OffchainLookup`
2. timeout and security policy for offchain fetches
3. observability labels distinguishing CCIP-Read misses from generic errors
