# ADR-056 — Indexer worker split trigger from event-loop lag

- **Status**: Proposed
- **Date**: 2026-05-20
- **Spec sections affected**: 8.4 (operationalization rider in M2/J3)

## Context

`apps/indexer` currently runs orchestration and derivation work in a single process. J1 introduces event-loop-lag gauges (`indexer_event_loop_lag_seconds_max`, `indexer_event_loop_lag_seconds_p99`) to make scheduler pressure observable in production before committing to a process split.

## Decision

Trigger a worker-process split for `apps/indexer` if `indexer_event_loop_lag_seconds_max` exceeds `0.25` seconds for at least 5 consecutive samples over one minute.

J3 finalizes this trigger criterion (and any hysteresis/reset policy) using M2 production telemetry.

## Rough split design (J3, 2026-05-21)

The fire-on-condition contract committed above leaves the implementation shape open. J3 records the rough split so the decision is pre-made — execution remains gated on the trigger firing during M2 acceptance (per M2 acceptance criterion B3 in plan-m2.md). The text below is intentionally a **candidate design**, not a binding implementation contract; specifics (exact naming, port assignment, module boundaries) are revisited in the follow-up rider that promotes ADR-056 to Accepted.

**Candidate split — workers that move out of `apps/indexer` into a new analytics-style worker app if the trigger fires**:

- **Snapshot worker** (Epic L's `voting-power-snapshot` module) — derived-path computation + sample verification. RPC-budgeted; runs per proposal `active`-transition.
- **Mirror ETL** (Epic Q's `mirror-etl` module) — daily 04:00-UTC PG→CH copy with 6h overlap. CPU + I/O burst once daily.
- **Reconciliation sweeps** (Epic P's three sweep modules under `apps/indexer/src/reconciliation/`) — CH-orphan, PG-orphan, orphan-state hourly sweeps.

**What stays in `apps/indexer`**:

- Event polling (the hot-path loop whose lag triggers the split).
- Archive write path (F1's PG-first-then-CH-then-PG protocol per ADR-041).
- Derivation workers (pre-derivation actor sweep + vote/delegation derivation).
- Reorg detector + Epic P's `reorg-signal-recovery-sweep` (must stay co-located with event polling for tight reorg-response semantics).
- DLQ retry worker (M1 carry-over) — colocated with archive write path for retry latency.
- Governor state reconciler (ADR-049) — chain-state-driven; tightly coupled to event polling.

The split keeps the hot-path event-loop scope minimal; everything that stays is either part of the chain-state-following critical path or has a tight latency coupling to it.

**Candidate app template.** A new worker app — candidate name `apps/analytics-worker` (not locked; final name set in the promotion rider) — would be created by copying the existing empty `apps/ai-worker/` template (NestJS standalone context via `NestFactory.createApplicationContext`, `enableShutdownHooks()`, `OpsServer`). `OPS_PORT` assignment follows the existing convention in CLAUDE.md (default 9091; per-process overrides set at deploy time) — no port number is committed here. The boundary is "scheduled / batch / analytical" vs "real-time event path."

**Hysteresis (deferred — needs M2 telemetry).** Exit criterion and reset policy (when does the indexer become eligible to re-absorb the split workers?) remain TBD until M2 acceptance produces actual lag samples. The amendment in this section is intentionally split-design-only; the trigger threshold above and any exit/hysteresis are finalised in a follow-up rider once the lag metric has steady-state data.

**Metric-name verification (J3 implementation gate).** ADR-056's trigger criterion above references `indexer_event_loop_lag_seconds_max`. The J1 PR (#184) introduces this metric. Before J3 commits, grep J1's metric registration to confirm `_max` was shipped (not `_p99` — plan-m2.md:91 contains a stale `_p99` reference). If J1 shipped a different aggregation, J3 either updates this text or J3 follows up with a rider; the metric name must match what the metric pipeline actually produces.

**Status.** Stays **Proposed**. Promotion to Accepted happens only when the trigger fires (split execution becomes binding) or when M2 acceptance demonstrates the split is unnecessary at this scale (closing the ADR as "Superseded — workers stayed unified in M2"). The "rough split design" appended here is reference material for the promotion rider, not itself an Accepted decision.
