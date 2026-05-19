# ADR-052 — Post-backfill reconciliation pass for event-silent state transitions

**Status:** Rejected  
**Date:** 2026-05-19  
**Rejected:** 2026-05-19  
**Related:** ADR-046, ADR-047, ADR-049

---

## Context

ADR-049 introduced a confirmed-head-driven reconciler that corrects event-silent proposal state
transitions (`pending`/`active`/`succeeded` → `defeated`/`active`/`expired`). The reconciler runs
inside the live indexer, firing on every confirmed block head.

Backfill (ADR-046, ADR-047) ingests historical events in chunks up to `cutoffBlock`. For proposals
whose voting window closed within the backfilled range, the `ProposalCreated` event is recorded and
`voting_ends_block` is populated — but no authoritative event exists for the `defeated` transition.
The backfill therefore leaves those proposals in `pending` state. Because `compound_proposal_meta`
rows are only created by the `ProposalQueued` event handler or by the live reconciler's
`markReconcileChecked` call, defeated proposals have no meta row and are invisible to no-op checks.

When the live indexer starts after backfill it will eventually drain the backlog through the
per-block reconciler, but "eventually" can span many blocks if the backlog is large and the batch
size is small. In practice we observed 46 proposals stuck in `pending` across Governor Bravo and
Governor OZ after a backfill run against a production-equivalent dataset — all with `voting_ends_block`
populated and no `compound_proposal_meta` row.

## Decision

Add a **post-backfill reconciliation pass** that executes after `BackfillDriver.run()` returns
`completed` and before `daoSourceRepository.clearBackfillState()` is called.

### 1. Source plugin opt-in

Extend `BackfillSourceRuntime` (the interface returned by `buildBackfillSourceRuntime`) with an
optional `reconcileAfterBackfill` hook:

```typescript
interface BackfillSourceRuntime {
  filter: ...;
  listenerFactory: ...;
  reconcileAfterBackfill?: (opts: PostBackfillReconcileOpts) => Promise<PostBackfillReconcileResult>;
}

interface PostBackfillReconcileOpts {
  rpcClient: { send<T>(method: string, params: unknown[]): Promise<T> };
  cutoffBlock: bigint;   // same value used as backfill confirmation boundary
  signal: AbortSignal;
}

interface PostBackfillReconcileResult {
  corrected: number;
  skipped: number;
  rpcFailed: number;
}
```

Sources that have no event-silent transitions (e.g. Governor Alpha, which is excluded from ADR-049
reconciliation) leave the hook absent. The backfill command calls the hook only when it is present.

### 2. Drain-all loop, not per-block batch

The live reconciler is batch-capped (`COMPOUND_STATE_RECONCILE_BATCH_SIZE`, default 50) because it
shares a block-head tick with other work. The post-backfill pass has no such constraint. It loops
`findStaleForReconciliation` → process → repeat until the result set is empty or the signal fires:

```
loop:
  rows = findStaleForReconciliation(sourceTypes, [{ chainId, confirmedThresholdBlock: cutoffBlock }], BATCH)
  if rows.length == 0: break
  for row in rows: reconcileRow(row)
  if signal.aborted: break
```

`BATCH` can be the same env-configured value or a fixed large cap (e.g. 200) since no live path
shares the process. Rows that return `already_consistent`, `guard_skipped`, or `missed_event` are
still watermarked via `markReconcileChecked` so the live reconciler skips them on startup.

### 3. Confirmed threshold equals backfill cutoff

The reconciler needs a `confirmedThresholdBlock` to gate eligibility (`voting_ends_block <
confirmedThresholdBlock`). The backfill cutoff (`head − 2 × reorgHorizon`) is the correct value:
events at or below that block are confirmed, and any proposal whose voting window closed before it
is eligible. Using the same block keeps the two subsystems' definitions of "confirmed" consistent
(ADR-046).

### 4. Failure handling

RPC failures on individual proposals are logged and counted but do not abort the pass or fail the
backfill. The live reconciler will process them on startup. A non-zero `rpcFailed` count is
surfaced in the backfill command's completion output so operators can tell whether the pass was
fully clean.

Decode-domain errors (unexpected state code) follow the same behaviour as the live path: log at
error level, count the row as `skipped`, continue.

### 5. Placement in backfill.ts

```typescript
if (outcome.status === 'completed') {
  if (sourceRuntime.reconcileAfterBackfill) {
    const reconcileResult = await sourceRuntime.reconcileAfterBackfill({
      rpcClient,
      cutoffBlock,
      signal: controller.signal,
    });
    // emit reconcileResult counts in completion output
  }
  await daoSourceRepository.clearBackfillState(row.id);
}
```

The hook runs inside the existing signal scope so SIGINT/SIGTERM aborts it cleanly.

### 6. Compound plugin implements the hook

`buildBackfillSourceRuntime` for `compound_governor_bravo` and `compound_governor_oz` returns
`reconcileAfterBackfill`. The hook constructs a `CompoundReconcileDriver` with a no-op metrics
adapter (metrics are optional for a one-shot pass) and runs the drain loop.

`compound_governor_alpha` does not implement the hook (consistent with ADR-049 exclusion).

## Consequences

- Proposals with event-silent terminal states are in their correct final state the moment backfill
  completes, without waiting for the live reconciler to drain the backlog.
- The live reconciler's first tick after backfill finds an empty (or near-empty) stale queue;
  startup latency for accurate state is eliminated.
- RPC cost is proportional to the number of stale proposals, bounded by their count times one
  `eth_call` per proposal. For a full historical backfill this is expected to be in the tens to
  low hundreds of calls — negligible compared to the block-range scan.
- No new persistent state is introduced. The pass uses the same `compound_proposal_meta` watermark
  as the live path, so a crashed or signal-aborted post-backfill pass is safe to re-run: already-
  watermarked rows are skipped immediately.
- Backfill signal handling is unchanged: aborting during the pass leaves the backfill in
  `completed` state from `BackfillDriver.run()`'s perspective, so `clearBackfillState` is not
  called and the pass will re-run on the next `backfill start` invocation if the operator
  re-triggers it (or it is skipped and the live reconciler handles the remainder).

## Alternatives considered

- **Drain at live-indexer startup instead of backfill completion.** Rejected: the startup gap
  detection (ADR-051) already adds work to startup; adding an unbounded reconcile drain compounds
  startup latency and mixes concerns. Backfill completion is the natural place to close the gap
  it created.
- **Increase `COMPOUND_STATE_RECONCILE_BATCH_SIZE` in live indexer.** Rejected: this trades
  per-block tail latency for a one-time backfill artifact. The live path's batch cap is correct for
  steady-state; the backfill pass is a different operating mode.
- **Run reconciliation inside `BackfillDriver` itself.** Rejected: `BackfillDriver` lives in
  `@sources/core` and is source-agnostic. Compound-specific reconciliation logic does not belong
  there.

## Rejection rationale

The problem this ADR set out to solve does not require a dedicated solution.

`findStaleForReconciliation` uses a `LEFT JOIN` on `compound_proposal_meta`, so proposals that
have no meta row (i.e. were never queued and never previously reconciled) are fully eligible for
the live reconciler. Both gate conditions — `voting_ends_block IS NOT NULL` and
`voting_ends_block < confirmedThresholdBlock` — are satisfied by the stuck proposals observed in
the logs that motivated this ADR.

On the first confirmed-head tick after the live indexer starts, all stuck proposals are resolved
in a single batch (the observed count of 46 is below the default `COMPOUND_STATE_RECONCILE_BATCH_SIZE`
of 50). The actual window of incorrect state is one Ethereum block (~12 seconds), not "many
blocks" as stated in the Context section above.

The post-backfill hook interface (`reconcileAfterBackfill` on `BackfillSourceRuntime`) adds
accidental complexity — a new interface contract, result type, and drain loop — to eliminate a
gap that is already closed by the existing live reconciler within one block. The cost is not
justified by the benefit.

No implementation should be based on this ADR. The live reconciler (ADR-049) handles the
post-backfill cold-start case correctly via its LEFT JOIN eligibility query.
