# ADR-039 — Compound proposal choice ordinal mapping aligns with on-chain `castVote` enum, not SPEC §2.4.6

- **Status**: Accepted (2026-05-10)
- **Date**: 2026-05-10
- **Spec sections affected**: 2.4.6
- **Related**: `docs/plan-m1-e1.md` (E1 Compound seed), G1 derivation worker

## Context

SPEC §2.4.6 documents the canonical proposal-choice list for Compound governance as:

> The choices are: `index 0 = "For"`, `index 1 = "Against"`, `index 2 = "Abstain"`.

The actual on-chain Compound Governor Bravo `VoteType` enum, defined in `GovernorBravoDelegate.sol` and consumed by `castVote(uint256 proposalId, uint8 support)`, is:

```solidity
enum VoteType { Against, For, Abstain }  // 0, 1, 2 respectively
```

Verifiable in the deployed contract source on Etherscan ([Governor Bravo Delegate `0xeF3B6E9e13706A8F01fe98fdCf66335dc5CfdEED`](https://etherscan.io/address/0xeF3B6E9e13706A8F01fe98fdCf66335dc5CfdEED#code)) and in [Compound's official governance docs](https://docs.compound.finance/v2/governance/).

If `proposal_choice` rows were materialized per the SPEC §2.4.6 ordering, every Compound vote in `vote.primary_choice` (a denormalization of the highest-weight choice index — see SPEC §2.4.7) would resolve to the wrong label. A vote cast on-chain with `support = 0` (intent: "Against") would render in Kvorum's UI and API as `"For"`. The same inversion would propagate to:

- The dashboard's per-proposal tally chart (6.10).
- The cross-DAO proposal list (4.6.1) when filtered by outcome.
- The §4.6.2 analytical endpoints that compute per-delegate alignment (any "alignment with this delegate's For votes" metric becomes meaningless).
- Vote-aggregation materialized views (deferred to v1.x analytical-mirror layer per ADR-026, but the schema must produce the right values from M1).

This is the kind of bug that ships and is not noticed until somebody loads a contentious proposal and sees the For/Against bars swapped from what Tally / Compound's own UI shows.

## Decision

**Compound proposal choices are seeded with on-chain ordering, not SPEC text ordering.** This ADR is authoritative for v1; SPEC §2.4.6's example list is treated as incorrect on this point.

Concretely:

- M1 Compound seed (`libs/sources/compound/src/seed.ts`) inserts `proposal_choice` rows as `(0, 'Against')`, `(1, 'For')`, `(2, 'Abstain')` per Compound proposal.
- G1 derivation worker materializes `vote.primary_choice` from on-chain `support` values directly, with no remapping.
- G1's test suite asserts the mapping against the GovernorBravoDelegate `VoteType` enum, not against SPEC §2.4.6 text.
- Aave (M3) and Lido on-chain governance (M3) use the same `VoteType` ordering by inheritance from Governor Bravo; this ADR's mapping applies.
- Snapshot proposals are unaffected — Snapshot uses arbitrary `choices` arrays with caller-supplied labels and a 1-based index per SPEC §2.4.6.

## Alternatives considered

- **Use the SPEC §2.4.6 ordering verbatim and translate at API boundary.** Rejected. Adds a remapping layer that must apply to every read path and every analytical query. Introduces a continuous source of subtle bugs whenever a future engineer reads a `support` value without realizing it's been remapped (or whenever they read `proposal_choice.index` and assume it matches on-chain semantics).
- **Treat SPEC §2.4.6 as immutable and accept the inversion in the UI.** Rejected. The product is "make DAO governance legible" — shipping a known For/Against inversion is a flat product failure.
- **Patch SPEC §2.4.6 directly.** Not allowed — SPEC is the v1.0 immutable baseline (per `docs/adr/README.md`'s framing). ADRs are the mechanism for amending it.

## Consequences

- **SPEC §2.4.6's choice example is incorrect on this point.** This ADR overrides it. Reading SPEC + ADRs in order produces the correct mapping. The README index lists ADR-039 with SPEC §2.4.6 as the affected section.
- **G1 derivation tests** assert the mapping with a fixture extracted from a real on-chain proposal and a known vote (e.g., proposal 42, a known "Against" vote — the test confirms `primary_choice` resolves to the row labeled `"Against"`).
- **Future Aave / Lido governance integration (M3)** inherits the same mapping with no further ADR — Governor Bravo's `VoteType` enum is the contract-level standard.
- **No schema change required.** The `proposal_choice` shape (proposal_id, index, label) accommodates either ordering; only the seed values change vs. what a literal SPEC reading would produce.
- **No M2 vote-table change required.** `vote.support_index` (or equivalent) stores the raw on-chain value, which is now interpreted consistently across the codebase.
- **Documentation update:** `libs/sources/compound/README.md` (created in PR 2) cites this ADR and the on-chain enum source.

## Implementation notes (M1-specific)

- E1 / PR 2 commits the Compound seed with the on-chain ordering and a unit test that round-trips a known proposal's choice rows.
- G1 commits the test fixture against a known vote on a real proposal (block-anchored, not mocked) so the mapping correctness is anchored to mainnet rather than internal assumptions.
- A comment in `libs/sources/compound/src/seed.ts` references this ADR and the on-chain enum source URL.
