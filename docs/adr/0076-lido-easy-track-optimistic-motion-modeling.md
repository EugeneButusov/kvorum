# ADR-076 — Lido Easy Track modeled as optimistic-objection proposals

- **Status**: Accepted
- **Date**: 2026-06-28
- **Spec sections affected**: 2.4.4, 2.4.6, 3.8
- **Related**: ADR-021 (vote supersession), ADR-024 (DG history), ADR-030 (title extraction), ADR-049 (reconciliation), ADR-0062 (CH source of truth)

## Context

Easy Track is Lido's fourth on-chain governance path and carries a large share of its routine governance volume (node-operator limits, reward-program funding, allowed-recipient top-ups). It is a fundamentally different lifecycle from the other three tracks:

- A motion is created by a permitted address through a registered factory, carrying an EVMScript.
- It then runs an **objection window** (the standard duration is 72h; the contract enforces a 48h floor). The window is _optimistic_: the motion auto-enacts when the window closes **unless** holders of at least 0.5% of LDO submit objections, in which case it is rejected.
- There are **no per-voter affirmative votes** — silence is assent. An objection is a token-weighted threshold signal, not a ballot.

The unified schema models proposals, votes, and a per-source extension table. The question this ADR answers: how does an optimistic-objection motion map onto that model without distorting either the `proposal` state machine or the `vote` concept?

The motion lifecycle events (`MotionCreated`, `MotionObjected`, `MotionEnacted`, `MotionRejected`, `MotionCanceled`) are ingested into the per-source ClickHouse archive by the ingestion adapter; this ADR governs their derivation into the unified model.

## Decision

1. **A motion is a `proposal`** under `source_type = 'easy_track'`, `source_id = motionId`, `binding = true` (motions execute on-chain via the EVMScriptExecutor → Agent). The lifecycle maps onto existing `proposal_state` values — no new state is introduced:

   | Motion event     | `proposal.state`         | `easy_track_motion_meta.state` |
   | ---------------- | ------------------------ | ------------------------------ |
   | `MotionCreated`  | `active`                 | `active`                       |
   | `MotionObjected` | _(unchanged — `active`)_ | `objected`                     |
   | `MotionEnacted`  | `executed`               | `enacted`                      |
   | `MotionRejected` | `defeated`               | `rejected`                     |
   | `MotionCanceled` | `canceled`               | `canceled`                     |

   Terminal transitions go through the guarded, terminal-locked `advanceState`, so out-of-order or repeated delivery is safe. The motion-side state lives on the `easy_track_motion_meta` extension; the `objected` annotation is guarded so a late objection cannot regress a motion that already reached a terminal state.

2. **No `vote` rows.** An objection is a threshold event, not a per-voter ballot — it is recorded only as the `objected` motion-meta annotation, never in `vote`/`vote_events_*`. Forcing objections into the vote model would misrepresent both the affirmative-by-silence semantics and the absence of per-voter affirmative records. Objectors are not resolved as actors in v1 (nothing references them).

3. **The objection window is computed at derivation time.** `MotionCreated` carries neither a start time nor a duration, and `easy_track_motion_meta.objection_ends_at` is non-nullable, so the window is `blockTimestamp(MotionCreated) + motionDuration`:
   - the block timestamp is fetched on-chain (the same batched block-timestamp path the Aragon vote derivation uses);
   - the `motionDuration` in force at the creation block is reconstructed from the archived `MotionDurationChanged` timeline (the settings event is captured at ingestion), with a pinned genesis default for the window before the first such event.
     The on-chain `getMotion` getter is rejected for this: the contract deletes a motion from storage on close, so the getter reverts for historical/backfilled motions. Because the block timestamp is resolved synchronously, the proposal's `voting_starts_at`/`voting_ends_at` are set directly (start = block time, end = objection deadline) rather than deferred to the asynchronous timestamp filler.

4. **Title is a deterministic placeholder** (`Easy Track motion #{id}`); the motion's enacting EVMScript is decoded into `proposal_action` rows at `MotionCreated` derivation (best-effort, reusing the shared Aragon EVMScript decoder — the script is archived in the event, so no on-chain read is needed). Description stays empty until a richer title/summary lands.

5. **The optimistic pass is reconciled, not event-driven.** Every _terminal_ motion transition emits an event, but the objection window simply closing does not. A reconciler (the `easy_track_reconcile` source) reads `getMotions()` at each confirmed head: a motion still present past its window has necessarily passed (objections below threshold, else rejected-and-deleted), so the reconciler advances the proposal `active → queued` — a guarded, event-silent transition. A motion _absent_ from `getMotions()` has closed; the reconciler does not infer which terminal (enacted/rejected/canceled are indistinguishable once the motion is deleted) and leaves it to the authoritative terminal event. `queued` is a proposal-level state only; `easy_track_motion_meta.state` stays `active` (the on-chain motion is genuinely still active, just past its window) until the terminal event arrives.

## Consequences

- Easy Track motions surface alongside Aragon binding votes, Snapshot signaling, and Dual Governance proposals, distinguished by `source_type` and queryable through the same proposal surface, with decoded `proposal_action` rows. The "four governance models for one DAO" claim holds with no core-entity semantic change — one extension table (`easy_track_motion_meta`) and a state mapping.
- "Who objected to this motion" is intentionally not modeled in v1; only that objections occurred (the `objected` annotation). Per-objector detail is a future extension if needed.
- A genuinely dropped terminal event (never ingested) would leave a passed motion stuck at `queued`; recovering it via a targeted log re-scan is a deferred hardening (the confirmed-head pipeline makes a dropped terminal unlikely).
