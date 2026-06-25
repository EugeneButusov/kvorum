# ADR-0074 — Lido Dual Governance modeling

- **Status**: Proposed
- **Date**: 2026-06-25
- **Spec sections affected**: 2.5, 3 (Lido)
- **Related**: ADR-024 (DAO-wide history), ADR-049 (on-chain reconciliation), ADR-031 (`vetoed` state), KNOWN-003; Epic AB (#311), AB0 (#327), AB1 (#328), AB2 (#329)

## Context

Lido's Dual Governance (DG) went live 2025-06-30; the current contracts are a post-Immunefi redeploy at
2025-08-08. It is a **DAO-wide state machine** over an `EmergencyProtectedTimelock`, with stETH-holder
veto power. AB0 (#327) vendored and live-verified the deployed contracts (addresses, blocks, bytecode
hashes, getters — recorded in `libs/sources/lido/src/dual-governance/VERIFICATION.md`); AB1 (#328)
archives the DG + Timelock event set. This ADR records the modeling decisions that AB2–AB4 implement so
the rationale is externalised, not held in one developer's head.

## Decision

### 1. State enum + DAO-wide history (ADR-024)

On-chain `State` is `NotInitialized(0), Normal(1), VetoSignalling(2), VetoSignallingDeactivation(3),
VetoCooldown(4), RageQuit(5)`. State is modeled as a DAO-wide append-only history per ADR-024, not
per-proposal. The PG `dual_governance_state` enum **omits `NotInitialized`** — it is pre-init only and
is never a persisted _to_-state (the first transition is NotInitialized→Normal, stored as `Normal`). So
on-chain→PG mapping is **by name, not ordinal** (the on-chain enum is offset by 1). An unmappable
to-state throws (→ DLQ) rather than guessing.

### 2. Lazy transitions — the reconciler is load-bearing

Transitions are applied lazily via `activateNextState()`. `getEffectiveState()` (what the machine would
be in if poked now) can differ from `getPersistedState()` (last stored) between a time-due transition
and its on-chain observation, and `DualGovernanceStateChanged` fires only on the _persisted_ transition.
So **event-silent transitions are the norm**: AB2 projects emitted transitions into the history; AB4
reconciles via `getEffectiveState()`/`getStateDetails()` to catch the silent ones. There is no
`getState()`.

### 3. Bulk cancellation is a range

`cancelAllPendingProposals()` cancels every non-executed proposal with id ≤ a boundary, surfaced as the
Timelock's `ProposalsCancelledTill(proposalId)` — one event carrying the boundary. It is **archived as a
single boundary-carrying row** and interpreted as a range at proposal-derivation time (AB3); it is never
expanded to per-proposal rows at archive time.

### 4. N:M Aragon↔DG correlation has no on-chain _field_ link — but shares the enactment tx

A DG-submitted proposal carries **no on-chain reference field** to its originating Aragon vote. (Two
distinct `ProposalSubmitted` events exist — the DG-layer one carrying proposer + metadata, and the
Timelock one carrying the calls — sharing only `proposalId`.) However, the Aragon enactment script calls
`submitProposal` **synchronously**, so the Aragon `ExecuteVote` and the Timelock `ProposalSubmitted`
ride the **same enactment transaction** — verified on real mainnet submissions (`VERIFICATION.md`,
2026-06-25: txs share exactly one `ExecuteVote`). AB3 therefore correlates on a **deterministic
tx-hash primary**: the Timelock submission's tx → the co-tx Aragon `ExecuteVote` payload `{voteId}` →
the Aragon `proposal` (`source_id = voteId`). The drafted `(executor = AdminExecutor, calls-hash,
time-window)` heuristic remains a documented **fallback** for any non-co-tx submission. This covers:
1:1 Aragon→DG; omnibus; a **direct DG submission with no Aragon origin → its own `proposal` row under
`dual_governance`** (proposer + metadata from the co-tx `ProposalSubmittedMeta`); an Aragon vote that
never reaches DG; and **resubmission-after-veto** (same calls, new id → idempotent). Correlation must
neither double-count nor orphan.

**Ledger + unified-state ownership (AB3).** Each submission is recorded in the `dual_governance_proposal`
ledger (keyed `(dao_id, dg_proposal_id)`, idempotent), tracking origin + the DG timelock sub-lifecycle
(`submitted → scheduled → executed | cancelled`). DG inner calls become `proposal_action` rows at
`payload_index = 1`. **AB3 owns the post-enactment unified `proposal.state`** = `f(ledger status)`
(`submitted/scheduled → queued`, `executed → executed`, `cancelled → canceled`), applied via the
guard-bypassing `ProposalRepository.setStateFromDerivation` (an absolute set, distinct from the
monotonic `advanceState`). This **reclassifies** the Aragon layer's premature `executed` (set on
`ExecuteVote`) back to `queued`, then drives it forward; it is replay-safe because the value derives from
the authoritative ledger, not the current state. A **cross-source defer** gate holds a submission (no
DLQ, no failed attempt) until the Aragon archive has covered its block, so a co-tx `ExecuteVote` is
guaranteed visible before a no-match is committed as direct.

> **Scope reality:** all 11 Timelock proposals to date are Aragon-originated; case 3 (direct) has no live
> instance yet and is validated by synthetic fixtures.

### 5. Escrow + rage-quit detail is reconciler-sourced

The signalling/rage-quit `Escrow` is a master-copy + EIP-1167 clones. Rage-quit ETH amounts and
veto-signalling episode timestamps are **not** on the state event; they are populated from escrow state
by the AB4 reconciler (the AB2 history rows leave those columns NULL). Emergency mechanisms
(ResealManager, EPT guardian, GateSeal) are KNOWN-003: detect + document, not modeled in M4.

## Alternatives considered

- **Per-proposal DG state** — rejected by ADR-024 (state is a DAO property; repeats data).
- **Store the on-chain ordinal directly** — rejected; the PG enum is name-based and omits `NotInitialized`, so mapping by name is unambiguous and analytics-friendly.
- **Expand bulk-cancel to per-proposal rows at archive time** — rejected; loses the range semantics that derivation needs.
- **Link DG↔Aragon structurally** — no on-chain _field_ link exists, but the shared enactment tx is a deterministic correlation key (§4); the `(executor, calls-hash, time-window)` heuristic is the fallback, not the primary.
- **Ledger-only, defer unified state to AB4 (correlated proposals)** — rejected; `advanceState` is terminal-locked at the Aragon-set `executed`, so a cancel-after-enactment could never reach the unified state. AB3 reclassifies via `setStateFromDerivation` instead, keeping `proposal.state` correct as of AB3.

## Consequences

- AB2 derives `DualGovernanceStateChanged` into the append-only history; "current state" and "state at T" are single indexed lookups, idempotent under replay (unique index + watermark).
- AB3 (#330) lands the N:M correlation + the DG-submitted proposal flow: the `dual_governance_proposal` ledger (`lido_006`), the tx-primary correlator, `setStateFromDerivation`, and the second projection deriver. AB4 owns reconciliation + escrow-derived detail and may extend ADR-031's `vetoed` transition.
- Status flips to Accepted when AB4 lands the reconciler this ADR specifies; AB2 ratifies sections 1–3, AB3 ratifies section 4.
