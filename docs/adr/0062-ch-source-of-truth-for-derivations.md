# ADR-0062: ClickHouse as source of truth for chain-event-derived data

- Status: accepted
- Date: 2026-05-28
- Supersedes: none
- Amends: 0021, 0033, 0038, 0041, 0053, 0056, 0058, 0059, 0061, 0067
- Related: ADR-0058 (confirmed-head ingestion — the premise), epic #216 (CH as source of truth), PRs #220 + #221 (shipped implementation)

## Context

Pre-cutover architecture (M0–M1) maintained a three-layer data flow:

1. **CH archive layer** — raw chain events from ingestion indexer (`archive_event_*` tables, append-only).
2. **PG projection layer** — derived data (`vote`, `delegation`, `voting_power_snapshot`), written daily via ETL from PG archive tracker.
3. **CH analytical mirror layer** — copy of PG projections for O3 API reads, written daily via PG→CH ETL.

This three-layer design introduced operational redundancy:

- Daily ETL latency meant O3 reads were 24 hours stale relative to the true state.
- Dual-write integrity was contractually challenging: the PG-first-then-CH-then-PG-retry protocol (ADR-041) was load-bearing only for archive ingestion, not for derivation.
- The mirror-ETL bookkeeping (scheduling, watermarks, DLQ state) added ~1.8k LOC + 6 PG tables + 1 cron job.

ADR-0058's confirmed-head-only model (read-at-`confirmedHead`, eliminate reorg machinery) created an opportunity: derivation can write directly to CH as the source of truth, collapsing the three layers to two and eliminating the daily ETL.

## Decision

**CH is source of truth for chain-event-derived data:**

- `archive_event_*` (raw chain events, append-only per ADR-0058)
- `vote_events_projection` (CH, derived from vote events)
- `delegation_flow_projection` (CH, derived from delegation events)
- `voting_power_snapshot_projection` (CH, derived from delegation + proposal state)

**PG is source of truth for everything else:**

- **Identity:** `actor` (entity identity), `actor_address` (chain addresses), `actor_address_redirect` (actor merges; depth-1 redirect graph)
- **Configuration:** `dao` (DAO metadata), `dao_source` (source registry), `source_type` (enum)
- **Proposal state machine:** `proposal`, `proposal_action`, `proposal_choice`
- **Derivation tracking:** `archive_event` (4-tuple idempotency cache + `derived_at` watermark per ADR-0058), `voting_power_snapshot_run` (per-proposal run status: `in_progress` / `completed` / `failed`)
- **Operator surface:** `ingestion_dlq` (dead-letter queue for irrecoverable ingestion errors)

Derivation appliers insert rows directly into CH projections with server-side `version DateTime64(6) DEFAULT now64(6)`. The `ReplacingMergeTree(version)` engine collapses duplicate keys on read via `FINAL`. After CH insert succeeds, the PG `archive_event.derived_at` watermark is updated. If the watermark fails, the next derivation tick re-runs the applier; CH absorbs the duplicate insert via version-overwrite.

## Operational invariants

### 1. Single-worker-per-protocol

v1 indexer runs a single process. There is exactly one worker per `(chain_id, source_type)` pair (verified at `apps/indexer/src/orchestrator/indexer-orchestrator.service.ts:99–129`).

The vote derivation applier's `SELECT FINAL → INSERT` supersession sequence (ADR-0021) is naturally serialised per `(proposal_id, voter_address)` under this invariant — no distributed coordination needed. Without it, two concurrent appliers could both observe no prior current vote and emit conflicting `superseded = 0` rows, violating the "one current vote per voter per proposal" property.

**Load-bearing for ADR-0021 correctness.** M3+ multi-worker scale-out requires either revisiting this invariant or adding distributed coordination (advisory locks per `(proposal_id, voter_address)`, or partition assignment by `chain_id`).

### 2. Address-based actor resolution at read time

CH stores chain addresses (`voter_address`, `delegator_address`, `delegate_address`, `actor_address_redirect` Dictionary). PG `actor_address` rows map addresses to actor IDs; `actor_address_redirect` rows model actor merges (depth-1 redirect graph maintained by the merge applier).

Read-path actor resolution happens at query time via the CH `actor_address_redirect` Dictionary, which resolves chain addresses to current actor identities. The redirect-flatten step in `executeMerge` keeps the graph depth-1 — single LEFT JOIN suffices.

### 3. CH `actor_address_redirect` Dictionary freshness

The CH Dictionary (`LAYOUT(HASHED())` — single-string PK — `LIFETIME(MIN 30 MAX 90)`) backs O3 actor-level grouping by serving address→current-actor lookups inline in SQL.

The `LIFETIME(MIN 30 MAX 90)` configuration sets the upper bound: a freshly-completed actor merge takes up to ~90 seconds to become visible in O3 aggregations. This window is unavoidable under the current CH Dictionary semantics; it is **not** a tuning parameter that operators should adjust without understanding the downstream implications.

Snapshot read repo falls back to `actor_id_hint` for Dictionary-miss recovery; address-based grouping at SUM time keeps the read consistent across the freshness window.

**Load-bearing for any dashboard reasoning about "stale merge" surprises.** If an actor merge completes but O3 aggregations don't immediately reflect it, the ~90 s Dictionary refresh window is the expected upper bound.

### 4. ~90 s read-time freshness floor for actor merges

Combines invariants 2 + 3: the Dictionary's `LIFETIME(MAX 90)` and the address-based grouping at SUM time together set the freshness floor. After a merge completes, snapshots from the old address + the new address may still coexist in O3 results for up to ~90 s.

## Consequences

- **Drift modes collapse.** Pre-cutover: confirmed/pending/orphaned status states + dual-write integrity contract + daily ETL scheduling. Post-cutover: single append-only CH source, readers read-at-`confirmedHead`.
- **Freshness improves.** Pre-cutover: O3 reads were 24 hours stale (daily ETL batch cadence). Post-cutover: seconds (derivation tick frequency).
- **Mirror-ETL bookkeeping deleted.** ~1.8k LOC, 6 PG tables (`mirror_etl_run`, `mirror_etl_chunk`, etc.), 1 enum (`mirror_etl_run_status`), 1 cron job removed in PR-2 #221.
- **Supersession and actor-merge become read-side concerns.** Write-side logic is simplified: appliers emit rows with version, CH deduplicates on read. Read-side logic (finding current votes, resolving merged actors) is expressed in SQL rather than hardcoded in application logic.

## Caveat: single-worker assumption is load-bearing

Multi-worker scale-out (M3+) requires either:

1. Revisiting the single-worker-per-protocol invariant and adding distributed coordination (e.g., advisory locks on `(proposal_id, voter_address)` or partition assignment per `chain_id`), **or**
2. Accepting that vote derivation may emit conflicting `superseded = 0` rows and relying on FINAL to de-duplicate (risks correctness if the tiebreaker logic is subtle).

Do not scale to multiple indexer instances per protocol without addressing this first. See ADR-0021 invariant note.

## On cross-reference conventions (D18)

ADRs that amend other ADRs use an `Amends: <list>` header line; each amended ADR gains the amending ADR's number on its own `Amends:` header line. The relationship is bidirectional and discoverable via either end of the chain.

**Example:** ADR-0058 lists `Amends: ADR-032, ADR-037, ADR-038, ADR-041, ADR-056` in its header; each of those ADRs now lists `Amends: ADR-0058` in their own headers. Later, ADR-0062 amends nine ADRs (021, 033, 038, 041, 053, 056, 058, 059, 061); those ADRs gain `Amends: ADR-0062`, and ADR-0062's header lists all nine. Following this pattern, the amendment chain is traversable from any end.

Future ADR amenders follow the same pattern.

## Not in scope

- `archive_event` PG tracker shrinkage for old-chain data (deferred to M3 per epic #216 §"Open follow-ups").
- Cursor stability across in-flight actor merges (deferred per epic #216 §"Open follow-ups").
- Materialised views for hot-read O3 aggregations (deferred).
- Point-in-time reads with `?as-of=<ts>` query parameter (deferred).
- Rewriting `voting-power-snapshot-projection-read-repository.ts` to drop `ALTER TABLE … DELETE/UPDATE` and use version-overwrite + FINAL (tracked in a follow-up issue per ADR-0053 amendment).
