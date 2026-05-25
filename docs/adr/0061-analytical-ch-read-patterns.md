# 0061 - Analytical CH read patterns

- Status: Accepted
- Date: 2026-05-25

## Context

O3 introduces the first API read endpoints backed by ClickHouse analytical mirror tables.

## Decision

1. Use `SELECT ... FINAL` for reads from `ReplacingMergeTree` analytical tables.
2. Reconstitute sentinels to nullable wire values at mapper boundaries.
3. Treat CH UInt256 values as strings at the DB boundary and parse to `BigInt` for arithmetic.
4. Avoid Float64 casts in ClickHouse SQL for governance voting power calculations.
5. Use bucket helpers for day/week/month aggregation in SQL.
6. Return analytics responses with `{ confirmed, mirror_ready, mirror_last_etl }` metadata.

## Consequences

Read logic stays deterministic and precision-safe, and clients can distinguish empty mirror warmup from ready data.
