# ADR-051 — Startup gap detection and catch-up ingestion

- **Status**: Proposed
- **Date**: 2026-05-19
- **Spec sections affected**: 3.10
- **Related**: ADR-027, ADR-046, ADR-047, ADR-037

## Context

Two gaps currently exist in the backfill-to-live handoff that no existing mechanism closes:

**Gap 1 — backfill-to-live cold start.** Backfill ends at block X (the chain head captured at backfill start). The live `EventPoller` is started some minutes later. Its first tick fetches `[currentHead − 2H, currentHead]`. If `currentHead − 2H > X`, events in `(X, currentHead − 2H)` are never fetched — they fall below the live window floor and above the backfill ceiling. The `event-poller.ts` comment (lines 17–19) acknowledges this and defers it to backfill, but no code enforces that a gap fill actually runs.

**Gap 2 — indexer downtime.** The live indexer runs for a while, advancing some internal head, then stops. On restart after extended downtime (> `2 × reorgHorizon` blocks, roughly 5 minutes on Ethereum mainnet), the poller window starts well above the last processed block, leaving the same class of gap.

In both cases the `EventPoller` cannot self-heal: it fetches only a fixed `2 × reorgHorizon` window per tick (`event-poller.ts:79–80`) and holds no persisted watermark.

The existing `BackfillDriver` already handles arbitrary `[from, to]` range ingestion and writes everything below `cutoffBlock = head − 2H` as `confirmed` directly. There is no reason to build a separate catch-up path when the driver already does exactly what is needed for these gaps.

## Decision

### 1. Persist a live ingestion watermark

Add `live_head_block BIGINT NULL` to `dao_source`. This column records the most recent block successfully processed by the live `EventPoller` for that source. It is updated after each successful poller tick, replacing the previous value (last-write wins — the column is a high-water mark, not a log).

`NULL` means the live poller has never completed a tick for this source.

### 2. Define the effective last-processed block

On indexer startup, for each `dao_source`, compute:

```
lastBlock = max(
  backfill_head_block  ?? (active_from_block - 1),
  live_head_block      ?? 0,
)
```

`active_from_block − 1` is used when backfill has never run so that a gap fill from block 0 (or the contract deploy block) is never silently skipped.

### 3. Define the gap

```
gapStart = lastBlock + 1
gapEnd   = currentHead − 2 × reorgHorizon
```

A gap exists when `gapEnd >= gapStart`.

There is no minimum gap threshold. A gap of one block still requires a fill; suppressing small gaps creates the same class of subtle correctness risk as suppressing large ones.

### 4. Fill the gap on indexer startup

Before the `EventPoller` starts for a source, the indexer checks for a gap and, if one exists, runs the existing `BackfillDriver` with:

```
mode    = fresh (force = true, to preserve existing backfill_head_block semantics)
fromBlock = gapStart
toBlock   = gapEnd
```

Because `toBlock = currentHead − 2H`, every event in the range satisfies `blockNumber <= cutoffBlock` and is written `confirmed` directly. The live poller then starts from its normal sliding window with no further coordination needed.

The gap fill runs **sequentially before** the `EventPoller` starts for that source. Parallel start (live + fill concurrently) is deferred; the sequential model is sufficient and simpler to reason about.

### 5. Gap fill failure does not block the live poller

If the gap fill errors or is cancelled (SIGINT/SIGTERM, matching ADR-047), the indexer logs the error with source ID and gap range, emits a `gap_fill_failed_total` counter, and proceeds to start the `EventPoller` normally. The operator can re-trigger manually (decision 6). Blocking live ingestion indefinitely on a fill failure would be worse than the gap itself.

### 6. Manual trigger via admin-cli

`admin-cli backfill catch-up <dao-source-id>` triggers a gap fill on demand without restarting the indexer. This is the resolution path for the long-downtime case where the operator wants explicit control. The command:

- reads `live_head_block` and `backfill_head_block` from the DB
- computes `gapStart`/`gapEnd` against the current chain head
- prints the gap range and asks for confirmation before running
- uses the same `BackfillDriver` as the startup path

### 7. `live_head_block` is not a backfill checkpoint

`live_head_block` is updated only by the live poller path. It is never read or written by `BackfillDriver`. The existing `backfill_head_block` / `backfill_started_at_block` columns are unchanged and continue to serve ADR-027's crash-resume and determinism guarantees.

## Alternatives considered

- **WebSocket-based head subscription with catch-up.** Would replace polling entirely and natively emit missed blocks on reconnect. Deferred by ADR-037; the gap problem predates WebSocket support and needs a solution that works under the current polling model.
- **Gap fill runs concurrently with live poller.** Avoids blocking live ingestion during a large historical gap. Rejected for now: concurrent writes from both paths to overlapping block ranges require careful ordering and add coordination complexity. Sequential is correct and auditable; concurrency can be layered on later if large gaps become operationally common.
- **Extend EventPoller with its own catch-up loop.** Would make the poller stateful and responsible for its own gap detection. Rejected: the poller is intentionally stateless (ADR-037, tick-dropping contract); adding state and history-fetching merges two distinct concerns. `BackfillDriver` already owns historical range fetching correctly.
- **Persist watermark in Redis / external store.** Rejected: `dao_source` is already the authoritative per-source state record for backfill progress; co-locating `live_head_block` there keeps all per-source progress in one row and one schema migration.

## Consequences

- Backfill-to-live and downtime-recovery gaps are closed for all sources that run the startup check.
- `dao_source` gains one nullable column. The schema migration is non-breaking (existing rows default to `NULL`; `NULL` is handled as "never polled" in the gap formula).
- The gap fill on startup may add latency before the `EventPoller` starts for a source with a large gap. The operator is expected to run `admin-cli backfill catch-up` proactively for sources known to have large gaps rather than letting startup block on them.
- `live_head_block` is a best-effort watermark: if the indexer crashes mid-tick before the update commits, the next startup gap fill re-processes up to one poller window of already-seen blocks. That re-processing is idempotent (ADR-041 unique key).
- The `gap_fill_failed_total` metric gives operators observability on gap fill failures without requiring log parsing.
