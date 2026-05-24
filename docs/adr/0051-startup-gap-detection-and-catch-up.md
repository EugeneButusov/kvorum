# ADR-051 — Startup gap detection and catch-up ingestion

- **Status**: Accepted
- **Date**: 2026-05-20
- **Spec sections affected**: 3.10
- **Related**: ADR-027, ADR-037, ADR-041, ADR-046, ADR-047

## Context

Two startup/downtime gap classes exist under sliding-window polling:

- gap between persisted contiguous history and current live poll window floor
- long downtime where `EventPoller` restarts at `[head - 2H, head]` and misses older unseen blocks

`EventPoller` is intentionally stateless for history and cannot close these gaps by itself. `BackfillDriver` already provides chunked historical fetch, checkpointing, cancellation, and resume.

## Decision

### 1. Remove `live_head_block`; use `backfill_head_block` as the contiguous floor

`live_head_block` is not used. The contiguous persisted floor is `backfill_head_block` (or `active_from_block - 1` when unset).

### 2. Start live poller first; run catch-up in parallel

Per source at boot:

1. Start live `EventPoller` immediately.
2. Wait for first **successful** tick head `L` (`onFirstHeadComplete`).
3. Run boot catch-up in background over `[floor + 1, L - 2H]`.

`H = headLag` and `L - 2H` is below reorg-sensitive range by construction.

### 3. Catch-up mode in `BackfillDriver`

`BackfillDriver` supports `mode='catch-up'`:

- floor = `backfill_head_block` else `active_from_block - 1`
- start = `floor + 1`
- end = supplied `toBlock` when provided by orchestrator
- when end is omitted (CLI/manual fallback), driver captures head and uses `head - 2H`
- advances `backfill_head_block` per chunk
- does **not** clear floor state on completion

### 4. Failure and shutdown behavior

- Catch-up is background work; live polling continues if catch-up fails.
- Startup/shutdown abort path must cancel pending catch-up wait and in-flight catch-up orchestration.
- `raceWithAbort` is used while waiting for first successful tick so shutdown does not hang when first tick never succeeds.

### 5. Operator controls

- `admin-cli backfill catch-up <source_type>` uses the same catch-up path in foreground.
- `admin-cli backfill start --from-block X` must satisfy:
  `X >= max(active_from_block, backfill_head_block + 1)`.

### 6. Current-stage concurrency rule (no lock yet)

Advisory locking is deferred at this stage. Operational rule:

- do not run manual `backfill catch-up` / `backfill start` for a source while that source is executing boot catch-up.

## Consequences

- Live ingestion is no longer blocked by startup catch-up.
- `backfill_head_block` becomes load-bearing restart state for contiguous history.
- Seam overlap is intentional and absorbed by idempotent writes (ADR-041).
- Without lock, concurrency safety is operationally enforced for now.
