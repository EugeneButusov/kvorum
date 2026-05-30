# ADR-059 — Manual chain rewind via admin-cli

**Status:** Proposed
**Date:** 2026-05-24
**Amends:** 0062, 0063

---

## Context

ADR-058 (confirmed-head-only ingestion) deletes the automatic reorg-handling plane. The indexer no longer attempts to detect or recover from chain reorganisations: every event we ingest is observed at or below `head − headLag`, where `headLag` is set per chain to a depth at which the canonical tip is considered final for our purposes.

This is correct for the failure modes we expect in production:

- Mainnet / Sepolia: post-Merge finality + `headLag = 12/40` makes deeper reorgs essentially impossible.
- Polygon PoS: `headLag = 128` covers the Heimdall-checkpoint pre-finality window.
- Optimistic L2s (OP, Base, Arbitrum): `headLag = 30–40` covers sequencer-level reorgs, which are short and have been the only kind observed in production.

The model has one documented carve-out: **L1-settlement reverts on optimistic L2s.** A successful fraud proof against a posted L2 batch could theoretically roll back L2 state up to ~7 days after the fact, deeper than any reasonable `headLag` value. The empirical record is zero — no fraud proof has ever succeeded on OP Mainnet, Base, or Arbitrum production. But "empirically zero" is not "impossible," and we want a documented recovery lever instead of "we would need to write the recovery tool during the incident."

Other situations the same lever would unblock:

- Misconfigured `headLag` for a new chain that causes `logsWithRemovedFlag` to fire (the defensive alert from ADR-058) — operator may decide to discard recent rows and re-ingest with a corrected lag.
- Local development / test environments where an operator wants to discard ingested state above a checkpoint and replay.
- Recovery from an upstream RPC provider that returned a non-canonical branch under partition (defensive; should not happen, but a single-tool recovery is preferable to ad-hoc SQL during an incident).

## Decision

Add a manual rewind command to `admin-cli`:

```
admin-cli chain rewind --chain <id> --to-block <N> [--dry-run] [--execute] [--source <type>]
```

Semantics: discard all ingested + derived state above block `N` for chain `<id>`, then reset cursors so a subsequent indexer start re-ingests from `N + 1` forward against the current canonical chain.

The command is intentionally manual: no scheduler, no auto-trigger, no daemon. Operators run it when they have decided that recovery is required, after diagnosing the underlying chain event.

### Scopes touched (PG)

1. `archive_event` — `DELETE WHERE chain_id = X AND block_number > N`
2. Derived per-event tables (votes, delegation events, etc.) — cascade via FK on `archive_event.id`, or explicit `DELETE WHERE block_number > N` for tables that do not FK to archive
3. Aggregate-derived tables (delegation balance projections, vote tallies) — invalidate by resetting the per-source derivation watermark; the derivation worker re-derives on next tick from the now-correct `archive_event`
4. Voting-power snapshots (ADR-053) — `DELETE FROM voting_power_snapshot_run WHERE target_block_number > N AND chain_id = X` (snapshot worker re-runs via existing retry path)
5. Proposal lifecycle rows — leave untouched; the on-chain state reconciler (ADR-049) self-heals from archive + current chain state on its next tick
6. Cursors — `UPDATE dao_source SET backfill_head_block = N WHERE chain_id = X` (and `--source` filter if given)
7. DLQ — `DELETE FROM ingestion_dlq WHERE payload->>'chain_id' = X AND (payload->>'block_number')::bigint > N`; same for `ingestion_dlq_resolved`

### Scopes touched (CH)

8. `archive_event_compound_*` (and other per-source archive tables) — `ALTER TABLE … DELETE WHERE chain_id = X AND block_number > N`. CH mutations are asynchronous; the command reports the mutation id and returns. A `--wait` flag blocks until `system.mutations.is_done = 1`.

### Out of scope for the command

- ~~ClickHouse analytical mirror tables (`vote_events_analytics`, etc., per ADR-038): mirror ETL re-runs from PG, so they self-heal once PG is corrected. No direct delete from the command.~~ _Superseded by ADR-0062 — no mirror ETL post-cutover._
- AI summaries and any downstream artefacts: explicitly out of scope. If a rewind invalidates a summary, the AI worker re-derives.

### Per-table rewind handler registry

Each derived table that survives the ADR-058 refactor and could be affected by a rewind must register a `RewindHandler`:

```ts
interface RewindHandler {
  table: string; // PG or CH table name
  scope: 'pg' | 'ch';
  describe(chainId: string, toBlock: bigint): Promise<{ rows: number }>;
  execute(chainId: string, toBlock: bigint): Promise<{ rows: number }>;
}
```

Handlers are aggregated centrally (e.g. via a `REWIND_HANDLERS` DI token) so adding a new derived table forces the implementer to think about rewind. The command iterates handlers in dependency order: PG aggregates → PG per-event → CH archive → cursors → DLQ.

### Operator UX

- `--dry-run` (default if neither `--dry-run` nor `--execute` given): prints a table of `(scope, table, rows-to-delete)` for the requested chain + block.
- `--execute` performs the deletes inside a single PG transaction (CH mutations are submitted separately and reported).
- The command refuses to run while the indexer process for the affected chain is up (checks a health endpoint or a control row in `system_status`); operator must stop the indexer first.
- All scopes report row counts to stdout and to a structured audit log row in `system_status` (new column or new table — to be designed in the implementing PR).

## Consequences

- Rare-but-non-zero L2 finality reverts have a documented, tested, single-command recovery path instead of a panic-time SQL session.
- The `RewindHandler` contract becomes part of the source-plugin authoring checklist (alongside ingester, deriver, archive writer). Any plugin author adding a new derived table must add a rewind handler.
- ADR-058's defensive `logsWithRemovedFlag` alert points operators at this command in its runbook.
- The command is destructive and operator-only; it is gated by `admin-cli` auth and explicit `--execute`. No automation surface invokes it.
- Cost of _not_ having it is bounded only by the speed at which an operator can write correct cascading-delete SQL during an incident. Cost of _having_ it is one command, one integration test, and a small per-source registry.

## Alternatives considered

- **Runbook of SQL statements, no command** — rejected: cascading deletes across PG + CH with cursor resets and aggregate-table invalidation is too error-prone to run by hand during an incident.
- **Automatic rewind triggered by `logsWithRemovedFlag`** — rejected: a runtime auto-revert would resurrect a partial reorg-handling plane and re-introduce the failure modes ADR-058 deletes. Operators are in the loop on purpose.
- **Full bidirectional reorg-handling restoration** — rejected: re-introducing the pending → confirmed → orphaned machine for the empirically-zero L1-settlement case is a bad trade against the ~2.5k LOC of complexity ADR-058 removes. Manual rewind is the right blast-radius match.

## Implementation notes (deferred)

- This ADR is **Proposed**, not Accepted, and **not in scope for the ADR-058 epic.** Implement after the confirmed-head refactor lands and stabilises.
- Estimated cost: ~4–6h for the command + per-table handlers across current PG/CH tables; +1h for an anvil-driven integration test (ingest, rewind, re-ingest divergent branch above `N`, assert end state matches the new branch).
- Implementing PR should ship: command code, `RewindHandler` registry + handlers for every table touched by ADR-058's `archive_event`/derivation refactor, one integration test, a runbook entry (`docs/runbooks/chain-rewind.md`) describing when to run it and the pre/post checks.

## Operational notes

- The command is for incident response only. Routine ingestion bugs do **not** call for `rewind`; routine bugs call for fixing the indexer code and letting normal forward ingestion correct itself.
- Pre-rewind operator checklist (to be detailed in the runbook): stop indexer for the affected chain, verify canonical chain state at `N` against a second RPC provider, confirm no in-flight derivation work, capture pre-rewind row counts, run `--dry-run`, review, run `--execute`, restart indexer, monitor `archiveWrites` and `underivedDepth` until they catch up.

## Amendment — 2026-05-28 (CH projections explicit cleanup)

The rewind handler registry must now include CH projection cleanup explicitly: `vote_events_projection`, `delegation_flow_projection`, `voting_power_snapshot_projection` — operator-driven `ALTER TABLE … DELETE WHERE block_number > N` per chain rewind. This is **scope-noting only**, not a contract change: the actual rewind handler implementation remains deferred per ADR-059's Proposed status.

## Amendment — 2026-05-30 (pg-boss jobs and seen_log must be purged on rewind — ADR-0063)

When `admin-cli chain rewind --chain X --to-block N` runs, the rewind handler registry must also:

1. **Cancel/delete all pending `archive_ch` jobs** in pg-boss whose `blockNumber > N` for chain `X` — these would re-ingest events on blocks being rewound, producing duplicate `archive_event` rows that the `ON CONFLICT` guard would silently drop, but whose CH payloads would persist.
2. **Delete `seen_log` rows** with `chain_id = X AND block_number > N` — otherwise the pruned coordinates would be treated as already-ingested by the producer on re-scan, and the events would never be re-enqueued.

The rewind command requires the indexer to be stopped for the affected chain (serialising against the consumer), so no in-flight jobs are racing during the purge. This is scope-noting only; the actual implementation remains deferred per ADR-059's Proposed status.

Cite ADR-0063.
