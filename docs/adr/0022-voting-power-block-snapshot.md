# ADR-022 — `voting_power_block` populated for Snapshot proposals

- **Status**: Accepted
- **Date**: 2026-05-08 (proposed); 2026-05-10 (accepted, ratified by E1 schema in `docs/plan-m1-e1.md` v3)
- **Spec sections affected**: 2.4.4, 3.6
- **Related**: KNOWN-006, DR-008

## Context

SPEC §2.4.4 describes `proposal.voting_power_block` as "nullable for purely off-chain votes that don't reference a specific block." This phrasing implies Snapshot proposals leave the field NULL.

That's incorrect. Every Snapshot proposal references an on-chain `snapshot` block — the block at which the strategy resolver evaluates voting power. KNOWN-006 explicitly turns on this fact (the trust boundary it documents only exists _because_ Snapshot reads on-chain state at that block). Leaving the field NULL discards information Kvorum already has and degrades cross-source queries like "which proposals snapshot voting power at block N."

## Decision

Populate `proposal.voting_power_block` for Snapshot proposals from the proposal's `snapshot` field. The block is interpreted on the chain identified by `snapshot_proposal_metadata.network` (already in §2.5).

NULL is reserved for the genuinely block-less case — a hypothetical future source whose voting power has no on-chain anchor. In v1, no such source exists; `voting_power_block` is non-NULL for every indexed proposal.

A clarifying note is added to §2.4.4's field description and to the OpenAPI schema:

> `voting_power_block`: The block at which voting power is evaluated for this proposal. For Snapshot proposals, this is the `snapshot` field reported by Snapshot, interpreted on the chain identified by `snapshot_proposal_metadata.network` (which may differ from the DAO's primary chain). NULL only for sources that do not anchor voting power to a specific block — none in v1.

## Alternatives considered

- **Leave NULL for all Snapshot proposals.** Loses information Snapshot itself reports; breaks "snapshots-at-block-N" queries; misleads anyone reading the schema into thinking Snapshot voting power is block-less.
- **Add a separate `snapshot_block` column on `snapshot_proposal_metadata`.** Redundant with the unified field; forces consumers to special-case Snapshot when reading voting-power semantics.
- **Add `voting_power_chain_id` to `proposal`.** Considered but unnecessary — the chain is already on the extension table for Snapshot, and on-chain Governor proposals use the DAO's primary chain by definition.

## Consequences

- KNOWN-006's mitigation tightens: when (rarely) a verifier needs to reason about the snapshot block's reorg posture, the block number is available without joining to the extension table.
- The cross-source query "list all proposals that snapshot voting power on Ethereum mainnet at blocks 19,000,000–19,100,000" works uniformly.
- Care needed in client code: the chain on which `voting_power_block` is interpreted is not always the DAO's primary chain. The OpenAPI documentation calls this out.
- One-line migration: backfill `voting_power_block` for existing Snapshot proposals from `snapshot_proposal_metadata.snapshot`.
