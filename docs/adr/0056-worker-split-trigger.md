# ADR-056 — Indexer worker split trigger from event-loop lag

- **Status**: Proposed
- **Date**: 2026-05-20
- **Spec sections affected**: 8.4 (operationalization rider in M2/J3)

## Context

`apps/indexer` currently runs orchestration and derivation work in a single process. J1 introduces event-loop-lag gauges (`indexer_event_loop_lag_seconds_max`, `indexer_event_loop_lag_seconds_p99`) to make scheduler pressure observable in production before committing to a process split.

## Decision

Trigger a worker-process split for `apps/indexer` if `indexer_event_loop_lag_seconds_max` exceeds `0.25` seconds for at least 5 consecutive samples over one minute.

J3 finalizes this trigger criterion (and any hysteresis/reset policy) using M2 production telemetry.
