# ADR-0058: Confirmed-head-only ingestion

- Status: accepted
- Date: 2026-05-24
- Supersedes: ADR-027, ADR-046
- Amends: ADR-032, ADR-037, ADR-038, ADR-041, ADR-056

## Context

The previous ingestion model used a reorg-handling control plane:

- rows inserted as pending in Postgres
- later promotion to confirmed
- orphaning on detected reorgs
- a dedicated `reorg_event` table and watcher/sweep services

This complexity existed only because ingestion read near the live tip.

## Decision

Adopt confirmed-head-only ingestion:

- all reads and polling are anchored to `confirmedHead = max(0, head - headLag)`
- events are written directly as canonical archive rows (`archive_event`)
- reorg handling services, statuses, and reorg-event persistence are removed

`headLag` is required per chain (renamed from `reorgHorizon`) and remains configurable.

Default operational values:

- Ethereum mainnet: 12
- Polygon: 128
- Base: 40
- Optimism: 40
- Arbitrum: 30
- Sepolia: 40

## Consequences

- `archive_confirmation` is replaced by `archive_event` semantics as the canonical archive table.
- `confirmation_status`, `confirmed_at`, `orphaned_at`, and reorg-link columns are removed from active schema/runtime semantics.
- Reorg watcher/detector/sweep code paths are deleted.
- Derivation reads underived archive rows directly (no confirmation-status predicate).
- Metrics and runbooks move from pending/reorg counters to lag and underived-depth signals.

## Notes

For optimistic rollups, `headLag` protects against sequencer-level reorgs. L1-settlement reverts are handled operationally via manual rewind procedures (ADR-0059).
