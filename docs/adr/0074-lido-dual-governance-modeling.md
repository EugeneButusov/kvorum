# ADR-0074 — Lido Dual Governance modeling

- **Status**: Accepted
- **Date**: 2026-06-25 (proposed); 2026-06-26 (accepted, ratified by the reconciler + veto work)
- **Spec sections affected**: 2.5, 3 (Lido)
- **Related**: ADR-024 (DAO-wide history), ADR-049 (on-chain reconciliation), ADR-031 (`vetoed` state), KNOWN-003, KNOWN-025; Epic AB (#311), AB0 (#327), AB1 (#328), AB2 (#329)

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

**Surface-only ruling — the reconciler does not write transitions.** Every _persisted_ transition
emits `DualGovernanceStateChanged`, which the state projection records authoritatively (correct EVM
identity + `enteredAt`). The only event-silent window is `effectiveState` running ahead of
`persistedState` until the next on-chain poke, which self-heals when that poke fires the event. So the
`dual_governance_reconcile` ingester is **observational**: it reads `getStateDetails()` at the confirmed
threshold and SURFACES drift as a `state_drift` metric/log + advances a per-DAO reconcile watermark
(`dual_governance_reconcile_state`, lido_007) — it never writes a history row. This mirrors ADR-049's
"never overwrite/guess event states" and avoids inventing a synthetic EVM identity for an effective
transition that fights the `(dao_id, block, tx, log_index)` unique index. A write-ahead model was rejected
(no live instance justifies the synthetic-identity/dedup machinery).

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

### 5. Veto/escrow detail — event-payload-sourced, rage-quit ETH deferred

The signalling/rage-quit `Escrow` is a master-copy + EIP-1167 clones. **Correcting the draft: the
`DualGovernanceStateChanged` `Context` tuple already carries the episode anchors** —
`vetoSignallingActivatedAt`, `normalOrVetoCooldownExitedAt`, `signallingEscrow`, `rageQuitEscrow`,
`rageQuitRound` — and the state projection archives the full payload. So the veto-signalling timestamps
(`veto_signaling_started_at` ← `vetoSignallingActivatedAt`; `veto_signaling_deactivated_at` ←
`enteredAt` on the deactivation sub-state) are filled by the **state projection from the event payload —
no reconciler RPC**. This supersedes the draft's "populated from escrow state by the reconciler".

`rage_quit_eth_amount` is **deferred** (left NULL; **KNOWN-025**): no rage quit has ever occurred
(`getRageQuitEscrow() == 0x0`), so the column is fixture-only, and the rage-quit Escrow balance getter
cannot be live-verified the way the vendored getters were — vendoring an unverifiable ABI would break
that discipline. The escrow _address_ is known from `context.rageQuitEscrow` if/when a real
rage quit makes the read verifiable.

Emergency mechanisms (ResealManager, EPT guardian, GateSeal) are KNOWN-003: detect + document, not
modeled in M4. They are **event-sourced** (`EmergencyModeActivated`/`Deactivated`, archived by the event
ingester) and the no-corrupt guarantee is **structural** — no deriver maps emergency events to `proposal.state` or
`dual_governance_state`, so an emergency action cannot corrupt normal-path state (the reconciler also
checks `isEmergencyModeActive()` as belt-and-suspenders). No ADR-075 is written: nothing has triggered
live, and the conditional ADR is only warranted when an emergency action is actually modeled.

## Alternatives considered

- **Per-proposal DG state** — rejected by ADR-024 (state is a DAO property; repeats data).
- **Store the on-chain ordinal directly** — rejected; the PG enum is name-based and omits `NotInitialized`, so mapping by name is unambiguous and analytics-friendly.
- **Expand bulk-cancel to per-proposal rows at archive time** — rejected; loses the range semantics that derivation needs.
- **Link DG↔Aragon structurally** — no on-chain _field_ link exists, but the shared enactment tx is a deterministic correlation key (§4); the `(executor, calls-hash, time-window)` heuristic is the fallback, not the primary.
- **Ledger-only, defer unified state to AB4 (correlated proposals)** — rejected; `advanceState` is terminal-locked at the Aragon-set `executed`, so a cancel-after-enactment could never reach the unified state. AB3 reclassifies via `setStateFromDerivation` instead, keeping `proposal.state` correct as of AB3.
- **Reconciler-sourced veto detail (§5, draft)** — superseded: the episode anchors ride the `DualGovernanceStateChanged` `Context`, so a pure event-payload projection is authoritative and replay-safe without an RPC dependency.
- **Write-ahead effective transitions (§2)** — rejected; introduces a synthetic-identity/dedup scheme against the event-identity unique index for a gap that self-heals, with no live instance to justify it. Surface-only chosen.
- **Fill `rage_quit_eth_amount` now via a vendored Escrow getter** — rejected; no rage quit has ever occurred, so the getter is unverifiable against a real instance (breaks the verify-what-you-vendor rule). Deferred as KNOWN-025.
- **A dedicated `vetoed` deriver on `DualGovernanceStateChanged`** — impossible: the derivation worker maps each `(source_type, event_type)` to exactly one deriver, so the rage-quit `vetoed` step lives inside the state-projection applier, and both `proposal.state` writers share one `resolveUnifiedProposalState` so they cannot diverge.

## Consequences

- AB2 derives `DualGovernanceStateChanged` into the append-only history; "current state" and "state at T" are single indexed lookups, idempotent under replay (unique index + watermark).
- The proposal-flow work lands the N:M correlation + the DG-submitted proposal flow: the `dual_governance_proposal` ledger (`lido_006`), the tx-primary correlator, `setStateFromDerivation`, and the second projection deriver.
- The reconciler + veto work lands: the veto-timestamp fill from the event `Context` (projection); the `vetoed` transition (ADR-031, realized) via the shared `resolveUnifiedProposalState` with veto-over-cancel precedence; the observational `dual_governance_reconcile` ingester (drift surface + watermark, `lido_007`/`lido_008`); the structural emergency-mode no-corrupt guarantee (KNOWN-003); and the rage-quit-ETH deferral (KNOWN-025). All veto/rage-quit/emergency paths are fixture-validated — no live instance exists.
- The state projection ratifies sections 1–3, the proposal-flow work ratifies section 4, and the reconciler + veto work ratifies sections 2 (reconciler) and 5 (detail) — this ADR is now **Accepted**.
