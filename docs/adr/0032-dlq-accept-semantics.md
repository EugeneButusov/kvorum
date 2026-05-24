# ADR-032 — DLQ `accept` is permanent acknowledgement, not retry

- **Status**: Accepted
- **Date**: 2026-05-08 (proposed); 2026-05-10 (accepted, ratified by `ingestion_dlq_resolved` table with `resolution_kind` enum + `original_dlq_id` UNIQUE in `docs/plan-m1-e1.md` v3)
- **Spec sections affected**: 6.20.1, 3.12

## Context

SPEC §6.20.1 lists the operator command:

```
admin-cli dlq accept <dlq_id> --reason <reason>
```

The semantics of `accept` are not defined. Plausible interpretations include:

1. "Permanently ignore this entry — we're not going to fix it; record why."
2. "I have manually corrected the underlying state out-of-band; don't retry, but treat the data as good now."
3. "Mark as resolved and trigger a re-derivation of dependent state."
4. "Delete the entry."

Each is a different operation. Without a definition, an operator running `accept` and another reading the audit log will disagree on what happened.

## Decision

`dlq accept` is **permanent acknowledgement without retry**. It records that the operator examined the entry and decided not to fix it, with the reason captured for audit. It does _not_ assert that the underlying data is correct, does not trigger re-derivation, and does not modify the event archive.

Behavior:

1. The DLQ entry is moved from `ingestion_dlq` to `ingestion_dlq_resolved`, an archive table with the same shape plus `resolved_at`, `resolved_by` (operator identity from SSH/sudo context per §6.20.1), `resolution_kind` (`accepted` here; `retry_succeeded` for entries cleared by `dlq retry`), and `reason` (free text, required).
2. The original event in the event archive (`archive_event_*` in ClickHouse and `archive_event` in Postgres) is _not_ modified.
3. The audit log records the command per §6.20.1's audit policy.

If the operator has corrected the underlying state via direct DB intervention (a separate, more dangerous act), that correction is its own audit-log entry and is not implied by `dlq accept`. The runbook for manual data correction explicitly states: _"After making the correction, run `dlq accept` with `--reason "manually corrected: <details>"` to clear the DLQ entry."_

`--reason` is non-optional (the SPEC's CLI definition already requires it). Empty or whitespace-only reasons are rejected client-side.

## Alternatives considered

- **`dlq accept` triggers re-derivation.** Conflates two operations. An operator who wants to re-derive should run `derive replay` (already in §6.20.1's command surface). Bundling them produces surprises.
- **`dlq accept` deletes the entry.** Loses the audit trail of "we decided not to fix this and why." Compliance-style queries ("how many ingestion errors did we explicitly accept?") become impossible.
- **`dlq accept` requires a confirmation flag.** The `--reason` requirement plus the audit log already create friction; adding `--confirm` would mismatch other non-destructive commands in §6.20.1.

## Consequences

- The `ingestion_dlq` table is bounded: every entry either retries to success (moved to `ingestion_dlq_resolved` with kind `retry_succeeded`) or is accepted (moved with kind `accepted`). It does not grow unbounded.
- Compliance and operational queries work: "show me all DLQ entries we explicitly accepted in the last 90 days, with reasons" is a single SELECT.
- The Grafana dashboard (§6.20.2) gains a panel for accepted-vs-retried DLQ disposition over time, useful for spotting categories of recurring failures the operator is silently absorbing.
- §6.20.1's command listing gains a one-line clarification: `dlq accept` permanently acknowledges; does not modify event state. The full semantics live here.
- `dlq retry` (already in §6.20.1) and `dlq accept` are mutually exclusive operations on a given entry. The CLI rejects accepting an already-resolved entry.
