# ADR-024 — `dual_governance_state` modeled as DAO-wide history

- **Status**: Proposed
- **Date**: 2026-05-08
- **Spec sections affected**: 2.5
- **Related**: KNOWN-007, DR-011

## Context

SPEC §2.5 lists `dual_governance_state(proposal_id, current_state, last_transition_at, …)` as a per-proposal extension table joined to `proposal`. This shape is wrong twice over:

1. Lido's Dual Governance is a DAO-wide state machine; its state at any given time is a property of the DAO, not of an individual proposal. Modeling it per-proposal forces redundant copies of the same state across every Aragon proposal active during a given period.
2. The field name `current_state` implies the row is mutable, contradicting the spec's append-only stance for governance events. Whether the field captures state-at-queue-time, current state, or full history is left ambiguous — three meaningfully different semantics.

For analytical work — "show me proposals queued during a veto-signaling period," "how long was Dual Governance in the rage-quit state in 2026?" — the right primitive is a DAO-scoped history.

## Decision

Replace the per-proposal extension with a DAO-wide history table:

```
dual_governance_state_history(
  id            uuid pk,
  dao_id        uuid fk,
  state         text,                 -- enum: normal | veto_signaling | veto_signaling_deactivation | veto_cooldown | rage_quit
  transition_at timestamptz,
  block_number  bigint,
  tx_hash       text,
  rage_quit_eth_amount      numeric  null,
  veto_signaling_started_at timestamptz null,
  veto_signaling_deactivated_at timestamptz null,
  payload       jsonb              -- raw event payload for audit
)
```

The table is append-only; one row per state transition. The current state is `SELECT DISTINCT ON (dao_id) state FROM dual_governance_state_history WHERE dao_id = $1 ORDER BY dao_id, transition_at DESC`. Querying state at time T uses the same pattern with `WHERE transition_at <= T`.

Proposals join opportunistically by timestamp: "what was the DG state when proposal P was queued" is `dual_governance_state_history` filtered by `dao_id = P.dao_id AND transition_at <= P.state_updated_at` ordered by `transition_at DESC LIMIT 1`. No FK from `proposal` to this table is needed.

The §2.5 extension list is updated: `dual_governance_state` (per-proposal) is removed; the DAO-wide history table is documented in its place.

## Alternatives considered

- **Keep the per-proposal extension capturing state at queue time only.** Loses the history needed for the analytical view ("how often did DG enter rage-quit"). Repeats data across every proposal.
- **Add both a per-proposal snapshot AND a DAO-wide history.** Redundant; introduces drift between the two sources of truth.
- **Model state transitions as rows in the existing event archive.** Plausible — DG state transitions are events. But the archive is per-source-type and DG events are already in `event_archive_dual_governance`. The history table here is the *derived* view; it remains in core entities for query convenience.

## Consequences

- Querying "what was the DG state at time T" is a single indexed lookup.
- Time-travel analytics ("proposals queued during a veto period") work without joins to the event archive.
- The DAO-wide nature is correct: an Aragon proposal queued during a veto period is governed by the same DG state as any other proposal in that period — no per-proposal copy is needed.
- The KNOWN registry gains no entry: this is an ADR-driven correction, not a deferral.
- Schema migration adds the new table; the old per-proposal extension is dropped (no historical data to migrate since v1 hasn't shipped).
