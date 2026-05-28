# ADR-0058: Confirmed-head-only ingestion

- Status: accepted
- Date: 2026-05-24
- Supersedes: ADR-027, ADR-046
- Amends: ADR-032, ADR-037, ADR-038, ADR-041, ADR-056, ADR-0062

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

## Per-chain finality basis

The `headLag` defaults above are operationally validated depths, but the finality _basis_ differs per chain:

| Chain                     | Basis                           | Notes                                                                                                                                                                                                |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ethereum mainnet, Sepolia | Post-Merge LMD-GHOST finality   | 12 blocks ≈ 2 epochs; a block two epochs deep is computationally final under honest-majority assumption.                                                                                             |
| Polygon                   | Heimdall checkpoint anchoring   | Polygon PoS finalises in Heimdall checkpoints written to Ethereum. 128 blocks ≈ one checkpoint interval; depth chosen to guarantee the block is within a committed checkpoint.                       |
| Base, Optimism            | Sequencer-reorg protection only | The sequencer rarely reorgs; 40 blocks covers transient sequencer forks. L1-settlement finality (fraud-proof window ≈ 7 days) is explicitly **not** provided at this depth — see L2 carve-out below. |
| Arbitrum                  | Sequencer-reorg protection only | Same basis as OP/Base; 30 blocks chosen for tighter sequencer-block cadence.                                                                                                                         |

Operators tuning `headLag` for a new chain should identify which finality basis applies and size the lag accordingly.

## L2 finality carve-out

For optimistic L2s (Base, Optimism, Arbitrum), `headLag` protects only against **sequencer-level reorgs** — situations where the sequencer reorders or drops its own batches before submitting them to L1. It does **not** protect against **L1-settlement reverts** triggered by a successful fraud proof, which can retroactively invalidate L2 state up to ≈7 days after the block was sequenced.

Empirical count of L1-settlement reverts on Base/Optimism/Arbitrum production: **zero** as of 2026-05-24.

If an L1-settlement revert occurs, the recovery path is manual: `admin-cli chain rewind --chain <id> --to-block <n>` per ADR-059.

## Amendment — 2026-05-28 (single-worker-per-protocol invariant added)

v1 indexer runs a single process; per-protocol there is exactly one worker for each `(chain_id, source_type)` pair.

This invariant is **load-bearing for ADR-021 correctness** post-CH cutover: the `SELECT FINAL → INSERT` supersession sequence in the vote derivation applier is naturally serialised per `(proposal_id, voter_address)` only because there is no second writer for the same `(chain_id, source_type)`. Without single-worker, two concurrent appliers could both observe no prior current vote and emit conflicting `superseded = 0` rows.

M3+ multi-worker scale-out requires either revisiting this invariant or adding distributed coordination (advisory locks per `(proposal_id, voter_address)`, or partition assignment by `chain_id`).

Cite ADR-0062 + ADR-021.

## FAQ: why is `dao_source_id` not in the idempotency key?

The 4-tuple `(source_type, chain_id, tx_hash, log_index)` is globally unique on the chain for a given source_type, making `dao_source_id` redundant. Specifically:

- `(tx_hash, log_index)` uniquely identifies a log in a block on a given chain.
- `chain_id` scopes across chains.
- `source_type` discriminates contract-family listeners (e.g., `compound_governor` vs `comp_token`). Two `dao_source` rows with the same `source_type` on the same `chain_id` must listen at _different contract addresses_, producing distinct `(tx_hash, log_index)` pairs — two DAO governance contracts emit distinct events. Two DAOs running the same source_type at the same address on the same chain are not a supported configuration.

`dao_source_id` is present as a column for query efficiency (watermark lookups, write-lag gauge) but must not appear in the unique constraint.
