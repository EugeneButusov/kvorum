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

## Amendment — 2026-06-14 (column dropped in M3 V3)

`proposal.voting_power_block` is dropped from the schema in M3 V3 (#262, pre-deployment). The Snapshot.org source (§3.6) that motivated this column has not shipped yet; when it ships in M4, re-add the column per the original decision. Until then the column does not exist.

Spec sections §2.4.4 and §4.7 are updated accordingly.

## Amendment — 2026-06-19 (Aave v3 L1 snapshot block not captured — superseded by the M3 V3 snapshot retirement)

The M3 plan (rev2, 2026-05-31) scheduled an Epic V amendment to this ADR to record that **Aave Governance v3 anchors voting power to an _Ethereum_ snapshot block** (`VotingActivated.snapshotBlockHash`) even though the _vote_ is cast on the voting chain (Polygon / Avalanche / mainnet backup) — i.e. the snapshot chain and the vote chain can differ. Plan tasks R2/S2 correspondingly listed `snapshot_block_hash` and `snapshot_block_number_l1` columns on `aave_proposal_metadata`, populated from `VotingActivated`.

That amendment is now recorded as **withdrawn-before-implementation**, because Epic V was rescoped:

- The voting-power **snapshot feature was retired entirely** in M3 V3 (#262 — see ADR-053 and ADR-066, both Withdrawn). Voter power now lives directly on the vote row as `vote_events_projection.voting_power`, sourced from `VoteEmitted.votingPower` (the proof-validated weight the VotingMachine already computed _at_ the L1 snapshot block). No code recomputes power from token state at the snapshot block.
- With no snapshot-block-driven computation, the L1 snapshot block hash has **no consumer**. Capturing it would be dead data.

**Shipped behaviour (deliberate):**

- `aave_proposal_metadata` carries `voting_chain_id`, `voting_machine_address`, `voting_strategy_address`, `creation_block` (+ `last_reconcile_check_block`, `created_at`) — and **no** `snapshot_block_hash` / `snapshot_block_number_l1` column (`libs/sources/aave/migrations-postgres/aave_001_extension_tables.ts`). This matches the frozen **SPEC §2.5** definition of `aave_proposal_metadata` exactly; it is the rev2 plan that over-specified.
- The `VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)` event is decoded only for `proposalId` + `votingDuration` (state advance to `active`); the indexed `snapshotBlockHash` is intentionally not extracted (`libs/sources/aave/src/governance-v3/abi/decoder.ts`, `VotingActivatedPayload` in `.../domain/types.ts`).

**Forward path.** If a holder-complete Aave voting-power snapshot — or any independent L1-anchored power verification — is built later (v1.1 territory, mirrors KNOWN-002 for Snapshot), re-add `snapshot_block_hash` + `snapshot_block_number_l1` to `aave_proposal_metadata` and capture `snapshotBlockHash` in the `VotingActivated` decoder per the original rev2 intent. Until then the field is not stored.

Spec section §2.5 (`aave_proposal_metadata`) is unaffected; the shipped schema conforms to it.
