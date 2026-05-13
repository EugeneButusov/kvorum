# ADR-043 - Voting window stored as blocks for block-anchored sources

- **Status**: Proposed
- **Date**: 2026-05-13
- **Spec sections affected**: 2.4.4, 4.5, 4.7
- **Related**: ADR-022 (`voting_power_block`), ADR-030 (title extraction), ADR-038 (ClickHouse archive layer), ADR-041 (cross-DB integrity contract), `docs/planning/plan-m1-g1.md`

## Context

Compound Governor's `ProposalCreated` event emits `startBlock` and `endBlock`, not start and end timestamps. At proposal creation those blocks are usually in the future. Converting them immediately to timestamps requires fabricating an estimate from current wall-clock time or an assumed block time, which drifts and creates a value that looks precise but is not source data.

The same shape is expected for other block-anchored governance sources in v1, including Aave and Lido on-chain flows. Snapshot is different: its proposal window is timestamp-anchored and can populate timestamp fields directly.

SPEC 2.4.4 currently models `proposal.voting_starts_at` and `proposal.voting_ends_at` as required timestamps. That is too strict for block-anchored sources whose future voting-window blocks have not been mined yet.

## Decision

Store block-anchored voting windows as block numbers first:

- Add nullable `proposal.voting_starts_block` and `proposal.voting_ends_block`.
- Make `proposal.voting_starts_at` and `proposal.voting_ends_at` nullable derived caches.
- For Compound Governor, write `startBlock` and `endBlock` verbatim into the block columns during proposal derivation.
- Fill timestamp columns lazily after the corresponding block is mined and beyond the configured reorg horizon.
- For timestamp-anchored sources such as Snapshot, leave block columns NULL and write timestamp columns directly.

This ADR amends SPEC 2.4.4, 4.5, and 4.7. API filters and sorting on `voting_starts_at` must tolerate NULL values, and proposal responses may contain NULL voting timestamps before the lazy fill has resolved them.

## Consequences

1. **Gain - source fidelity.** Block-anchored sources preserve the values emitted by the governance contract without storing fabricated timestamps.
2. **Gain - honest API semantics.** Consumers can distinguish "block known, timestamp pending" from a precise timestamp.
3. **Gain - cross-source compatibility.** Snapshot remains timestamp-native while on-chain governors remain block-native.
4. **Cost - nullable timestamp handling.** Readers and API filters must treat voting timestamps as nullable.
5. **Cost - derived fill job.** The derivation worker needs a small timestamp-filler loop that resolves mined blocks through the chain client.

## Alternatives considered

1. **Estimate timestamps at proposal creation.** Rejected. The values would drift and appear more precise than they are.
2. **Store only block numbers and remove timestamp columns.** Rejected. Timestamp queries and displays are core API ergonomics once the blocks are mined.
3. **Require both block and timestamp fields for every source.** Rejected. Snapshot is timestamp-anchored and has no canonical voting-window blocks.
