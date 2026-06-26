# ADR-031 — `vetoed` state scoped to Lido Dual Governance in v1

- **Status**: Accepted
- **Date**: 2026-05-08 (proposed); 2026-05-10 (accepted, ratified by `proposal_state` enum including `vetoed` in `docs/plan-m1-e1.md` v3; G1 derivation enforces the Lido-Aragon-only rule)
- **Spec sections affected**: 2.4.4
- **Related**: KNOWN-003

## Context

SPEC §2.4.4 includes `vetoed` in the unified `state` enum. The spec's narrative notes that "not every state applies to every source type — Compound never enters `vetoed`; Snapshot never enters `queued` or `executed` for non-binding signaling proposals." It does not say which sources _do_ produce `vetoed` in v1.

Two source types could plausibly enter `vetoed`:

1. **Aragon proposals affected by Lido Dual Governance.** When DG enters a rage-quit, in-flight Aragon proposals are effectively vetoed by the stETH-holder community.
2. **Aave proposals canceled by Guardian / Emergency Executor.** Within scope of KNOWN-003 (emergency governance not modeled in v1).

Without a clear rule, the implementation might surface `vetoed` inconsistently — applied to Aave Guardian cancellations in some code paths but not others.

## Decision

In v1, `vetoed` applies _only_ to Aragon proposals affected by Lido Dual Governance. Specifically: an Aragon proposal transitions to `vetoed` when the DG state machine enters a rage-quit while the proposal is in `queued` state and the rage-quit's effective period covers the proposal's execution window.

The transition is implemented in the derivation layer:

```
on_dg_state_transition(rage_quit):
  for proposal in queued_aragon_proposals(dao=lido):
    if rage_quit.affects(proposal.execution_window):
      proposal.state = 'vetoed'
      proposal.state_updated_at = rage_quit.transition_at
```

No other source produces `vetoed` in v1. Aave Guardian cancellations, Compound pause-guardian actions, and similar admin paths are tracked in v1.x as `governance_intervention` entities (KNOWN-003), separately from proposal state. When KNOWN-003 lands, `vetoed` may be extended; that extension is its own ADR.

## Alternatives considered

- **Remove `vetoed` from the enum until KNOWN-003 lands.** Shorter enum but forces a migration when emergency actions are modeled. The spec already commits to the unified enum being a superset; removing values defeats the design.
- **Apply `vetoed` to any cancellation-by-non-proposer.** Muddies the semantics with `canceled` (which already covers proposer-initiated and timelock-expired cancellations). Veto and cancellation are different actions; users care about the difference.
- **Leave the rule unspecified until implementation.** Risks inconsistent application across code paths; surfaces only when a Lido rage-quit happens in production and analysts notice.

## Consequences

- `?state=vetoed` API queries return Lido Aragon proposals that were vetoed by Dual Governance; nothing else in v1.
- The dashboard's state-filter UI labels `vetoed` accurately (`"Vetoed (Lido Dual Governance)"` or similar).
- The extension to admin-veto paths in v1.x is non-breaking: `vetoed` simply gains additional sources of transition. No schema or API change required.
- §2.4.4's enum description is updated with a footnote pointing here; the implementation includes a dedicated test exercising the DG → Aragon proposal veto transition.

## Implementation note — realized 2026-06-26

This ADR was Accepted-but-dormant since M1. It is now implemented for Lido Dual Governance:

- On a DG `rage_quit` transition (projected by the DG state deriver), every non-executed DG-routed
  proposal whose pending window `[submitted_at, cancelled_at ?? open]` is covered by the rage-quit is set
  to `vetoed` via `ProposalRepository.setStateFromDerivation`.
- **Veto outranks cancel:** a bulk-cancel (`cancelAllPendingProposals` → `ProposalsCancelledTill`) that
  lands inside a rage-quit window resolves to `vetoed`, not `canceled` — honouring "veto ≠ cancellation."
  An **executed** proposal stays `executed` (the veto did not stop it).
- Precedence is computed once in a shared `resolveUnifiedProposalState(ledger, history)` used by both the
  proposal-flow handlers and the rage-quit step, so the two `proposal.state` writers are replay-safe and
  order-independent (each derives from the authoritative ledger + DG state history).
- **Fixture-only:** no rage quit has ever occurred on mainnet, so the transition is validated by synthetic
  fixtures (`libs/sources/lido/tests/lido-dual-governance-reconcile.integration.spec.ts`), not live data.
- The extension to admin-veto paths (KNOWN-003) remains future work; this realization does not touch it.
