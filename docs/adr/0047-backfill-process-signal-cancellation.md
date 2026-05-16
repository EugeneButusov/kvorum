# ADR-047 — Backfill cancellation is process-local via SIGINT/SIGTERM

- **Status**: Accepted (2026-05-16)
- **Date**: 2026-05-16
- **Spec sections affected**: 6.20.1
- **Related**: ADR-046, ADR-041

## Context

Backfill runs in the foreground in `admin-cli`. The backfill driver already accepts an `AbortSignal`, so the simplest and most predictable cancellation model is to bind that signal to the lifetime of the running CLI process.

Earlier iterations experimented with a persisted cancel request on `dao_source`, but that added schema noise for a purely ephemeral concern and still required the operator to keep a foreground backfill process alive to do any useful work.

## Decision

Backfill cancellation is process-local:

- `admin-cli backfill start` owns an `AbortController`.
- The controller is aborted when the CLI process receives `SIGINT` or `SIGTERM`.
- There is no persisted backfill cancel flag in Postgres.
- The `backfill cancel` subcommand is removed.

Stopping the running CLI process is the cancellation mechanism.

## Consequences

- Cancellation no longer requires any DB coordination field or poll loop.
- The backfill path stays simpler and matches the actual runtime model: a foreground CLI job that ends when the process ends.
- Operators cancel backfill the same way they stop any other foreground process, by terminating the running CLI session.
- A dedicated background job runner would be required if we later want out-of-process cancellation again.
