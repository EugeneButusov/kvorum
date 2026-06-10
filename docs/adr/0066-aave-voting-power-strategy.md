# ADR-0066: Aave voting power strategy

- **Status**: Accepted
- **Date**: 2026-06-09
- **Amends**: 0053
- **Related**: 0022, 0243, 0260, 0261, 0262

## Context

Epic V needs an Aave Governance v3 `VotingPowerStrategy` that can:

- compute voter power for a proposal snapshot using Ethereum mainnet token state
- expose an independent reference value for later verification work
- register safely in the live snapshot worker before V3 resolves the final L1 snapshot block

The load-bearing constraints are different from Compound:

- Aave v3 power is anchored to an **Ethereum L1** snapshot block, even when voting happens on
  Polygon or Avalanche.
- Aave v3 does **not** expose a historical `getPowerAtBlock(user, block)`-style API on the voting
  assets. The usable read is `getPowerCurrent(user, delegationType)` executed against an archive
  Ethereum node at the snapshot block tag.
- `VoteEmitted.votingPower` is proof-validated by the protocol, but it only covers the assets whose
  proofs the voter actually submitted. The protocol explicitly allows a vote to use a subset of the
  available voting assets.

## Decision

### 1. Snapshot computation

For a proposal whose resolved L1 snapshot block is `N`, compute:

```text
computed(voter) =
  getPowerCurrent(voter, VOTING)@N on AAVE
  + getPowerCurrent(voter, VOTING)@N on stkAAVE
  + getPowerCurrent(voter, VOTING)@N on aAAVE
```

Implementation details:

- `VOTING = 0`
- the chain used for all power reads is Ethereum mainnet (`0x1`)
- the snapshot population for V1 is the proposal's **voters**, enumerated from vote rows
- snapshot rows persist both:
  - `actor_address`: the actor's primary address
  - `voter_address`: the address the vote/power was computed for

### 2. Arithmetic contract

The default aggregation is a plain three-way sum of `getPowerCurrent` returns.

We do **not** re-apply stkAAVE slash or `POWER_SCALE_FACTOR` math in the default path. That logic
belongs to the raw-storage-proof reconstruction path inside the governance contracts; it is not
needed when the token contract itself returns current power at block `N`.

Any manual slash/scale reconstruction remains a labelled fallback/debug path, not the production
default.

### 3. Verification contract

For Aave v3, `verifyOnChain(address, block, ctx)` returns the protocol-reported value:

```text
reported(voter) = VoteEmitted.votingPower
```

This is intentionally different from Compound's meaning of `verifyOnChain`.

- Compound: independent reference value is another on-chain read (`getPriorVotes`)
- Aave v3: independent reference value is the protocol's proof-validated reported vote power

The shared strategy interface therefore means "independent reference value for verification", not
"must always perform a live chain reread".

### 4. Full-proof verification rule

Because Aave vote submission accepts a subset of assets, the honest relationship is:

```text
reported <= computed
```

So:

- `reported > computed` indicates our computed path is wrong
- `reported == computed` identifies a full-proof voter
- `reported < computed` is ambiguous: either a partial-proof voter or an over-read bug

V1 therefore ships the calldata decoder that extracts submitted proof assets from `submitVote*`
calls, and ADR-066 pins the runtime verification rule used by V2:

- restrict strict equality checks to **full-proof** voters
- assert `computed == reported` for those voters
- treat `computed >= reported` as the broad invariant for all sampled voters

### 5. Safe live registration rule

Register the Aave strategy in the live plugin only together with a snapshot-candidate gate:

- skip `aave_governance_v3` proposals whose
  `aave_proposal_metadata.snapshot_block_number_l1 IS NULL`

This prevents the snapshot worker from writing Aave snapshots at the temporary proposal-creation
block before V3 lands the final L1 block-resolution path.

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

- V1 can ship the strategy safely before V3 by gating unresolved Aave snapshot candidates.
- Snapshot rows retain the voting address needed for Aave reconciliation while keeping the actor
  projection keyed by primary address.
- `verifyOnChain` remains source-polymorphic by contract, which avoids forcing Aave into a fake
  token-reread verification path that would be structurally blind to aggregation bugs.
- V2 must ingest or derive the submitted-proof asset set for sampled votes before it can implement
  the strict-equality verification loop.
- V3 remains responsible for replacing the temporary proposal-creation `voting_power_block` with
  the resolved Ethereum L1 snapshot block.

## Out of scope

- the snapshot worker sample-verify loop and discrepancy persistence
- runtime restriction to full-proof sampled voters
- correction of proposal `voting_power_block` to the resolved L1 block
- holder-complete Aave snapshots for non-voters
