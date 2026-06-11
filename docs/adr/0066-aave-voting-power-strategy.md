# ADR-0066: Aave voting power strategy

- **Status**: Accepted
- **Date**: 2026-06-09
- **Amends**: 0053
- **Related**: 0022, 0243, 0260, 0261, 0262

## Context

Epic V needs an Aave Governance v3 `VotingPowerStrategy` that can:

- project the authoritative per-voter power for a proposal snapshot
- preserve the actor-address normalization used by the shared snapshot surface
- explain what remains out of scope for future holder-complete snapshots

The load-bearing constraints are different from Compound:

- `VoteEmitted.votingPower` is the protocol's proof-validated value for the submitted vote and is
  already ingested into the vote projection.
- The current M3 snapshot population is **voters only**, not the holder-complete Aave token
  population.
- Aave vote submission allows a subset of proof assets, so token-derived "potential power" and
  vote-reported "used power" are different quantities by design.

## Decision

### 1. Snapshot computation

For M3's voter-only Aave snapshot, compute:

```text
snapshot_power(voter) = VoteEmitted.votingPower
```

Implementation details:

- the snapshot population is the proposal's **voters**, enumerated from vote rows
- the strategy reads `listVotersForProposal({ daoId, proposalId })`
- snapshot rows persist both:
  - `actor_address`: the actor's primary address
  - `voter_address`: the address the vote/power was reported for

### 2. Arithmetic contract

The snapshot stores the already-reported per-voter power exactly as emitted by the protocol.

No additional aggregation, slash reconstruction, or scale-factor math runs in the M3 snapshot path.
Those token-read mechanics remain future substrate only for holder-complete or non-voter Aave
snapshots, which are out of scope here.

### 3. Strategy contract

`VotingPowerStrategy` for Aave v3 now exposes only `computeSnapshot(block, ctx)`.

The earlier `verifyOnChain` design is withdrawn for Aave snapshots. Re-reading token contracts does
not verify the same quantity as `VoteEmitted.votingPower`; it computes a different "potential power"
surface and therefore cannot serve as a strict snapshot-validation mechanism.

### 4. Safe live registration rule

Because the voter-only snapshot reads already-derived vote rows, no Ethereum archive-state read is
required for Aave snapshot power in M3.

If future work adds holder-complete or non-voter Aave snapshots, that future strategy must define
its own gating and snapshot-block contract explicitly rather than reusing this voter-only one.

## Evidence

| Claim                                                                                   | Evidence                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AAVE and aAAVE mainnet governance-token addresses are pinned in the address book        | `AaveV3Ethereum.sol` in `bgd-labs/aave-address-book`: <https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Ethereum.sol>                  |
| stkAAVE mainnet address comes from the safety-module address book, not the V3 pool file | `AaveSafetyModule.sol` in `bgd-labs/aave-address-book`: <https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveSafetyModule.sol>              |
| `ProposalVoteStarted` carries the L1 block hash used for voting power                   | `IVotingMachineWithProofs.sol`: <https://github.com/bgd-labs/aave-governance-v3/blob/main/src/contracts/voting/interfaces/IVotingMachineWithProofs.sol> |
| `submitVote` accepts `VotingBalanceProof[]` and a vote may use only a subset of assets  | `IVotingMachineWithProofs.sol`: <https://github.com/bgd-labs/aave-governance-v3/blob/main/src/contracts/voting/interfaces/IVotingMachineWithProofs.sol> |
| `VoteEmitted` reports `votingPower` separately from the submitted-proof payload set     | `IVotingMachineWithProofs.sol`: <https://github.com/bgd-labs/aave-governance-v3/blob/main/src/contracts/voting/interfaces/IVotingMachineWithProofs.sol> |
| Governance v3 is explicitly storage-proof based and multi-chain                         | `aave-governance-v3` README: <https://github.com/bgd-labs/aave-governance-v3>                                                                           |

## Consequences

- Snapshot rows retain the voting address needed for Aave reconciliation while keeping the actor
  projection keyed by primary address.
- Aave voter snapshots no longer depend on Ethereum archive-state reads or a runtime sample-verify
  loop.
- Token-read Aave power logic is no longer part of the production snapshot path; if revived later,
  it should be introduced as a distinct holder-oriented feature, not as "verification" of reported
  vote power.

## Amendment — 2026-06-11 (reported-power snapshot replaces token-read verification)

Issue #261 withdraws ADR-066's token-read-and-verify design for the M3 snapshot path.

- The Aave snapshot value is `VoteEmitted.votingPower` read from the vote projection.
- `verifyOnChain` is removed from the shared `VotingPowerStrategy` contract.
- The earlier token-read computation (`getPowerCurrent` / asset aggregation / full-proof reasoning)
  is no longer the production snapshot mechanism.
- No Ethereum archive read is required for Aave snapshot power in M3.

## Out of scope

- holder-complete or non-voter Aave snapshots
- token-read reconstruction of potential Aave power
- holder-complete Aave snapshots for non-voters
