# ADR-0064: Multi-chain dao_source binding and chain-aware derivation dispatch

- **Status**: Proposed
- **Date**: 2026-06-01
- **Amends**: 0062, 0063
- **Related**: ADR-0058, epic #239, R0 #247, R1 #248

## Context

Aave uses one logical DAO across multiple chains under a single `source_type`. The derivation
worker previously dispatched archive rows by `(source_type, event_type)`, which allows a
single batch to mix chains. At the same time, the broader `dao_source` to chain binding
model needs to become explicit for multi-chain sources.

## Decision

### Chain-aware derivation dispatch (R0 — implemented here)

The derivation worker dispatches underived archive rows by
`(source_type, chain_id, event_type)`, not `(source_type, event_type)`.

Each `applyBatch` call therefore receives a single-chain batch by construction. Projection
appliers may rely on this invariant. The `ProjectionDeriver` interface does not change; only
the guarantee on each invocation is narrowed.

### dao_source.chain_id binding (R1 — #248)

Stub for R1. This section is completed in R1 with:

- per-source chain column on `dao_source`
- the four chain-resolution sites updated to use source-level chain binding
- backfill default to `0x1`

### AC#4 reinterpretation (R1 — #248)

Stub for R1. This section is completed in R1 clarifying extension-table scope and the chain
dimension boundary.

## Consequences

- Cross-chain head-of-line blocking is deferred to Epic Y. Mechanism:
  `findDerivableBy` orders `chain_id ASC` with no `derivation_attempt_count` cap, and
  appliers can DLQ a persistently failing row without calling `markDerived`. Under a real
  multi-chain backlog, low `chain_id` rows can repeatedly occupy `LIMIT` batches and starve
  higher chains.
- R0 intentionally leaves `findDerivableBy` unchanged. Compound remains single-chain (`0x1`),
  so the deferred liveness issue cannot manifest before Aave multi-chain backlog exists.
