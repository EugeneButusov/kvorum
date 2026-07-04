# ADR-071 — Non-EVM ingestion contract

**Status:** Accepted (poll transport, off-chain identity, and off-chain consumer sections all ratified + implemented)
**Date:** 2026-06-20
**Issue:** [#317](https://github.com/EugeneButusov/kvorum/issues/317), [#318](https://github.com/EugeneButusov/kvorum/issues/318), [#319](https://github.com/EugeneButusov/kvorum/issues/319)

---

## Context

The ingestion spine prior to M4 was EVM-only: `IngestSpec` was a two-variant union (`evm-event-poller` | `evm-block-head-poller`), the orchestrator required a `ChainConfig` for every source, and the confirmed-head / `seen_log` / 4-tuple idempotency mechanisms in ADR-0058 and ADR-0063 assumed reorg-able block-lattice coordinates.

M4 introduces Snapshot (GraphQL polling) and Discourse (HTTP polling) as off-chain, blockless sources. These sources do not sit on any EVM reorg plane and do not produce on-chain log events, so the EVM-specific finality and idempotency mechanisms are inapplicable. A new contract is required.

### Why EVM mechanisms are inapplicable off-chain

- **Confirmed-head / headLag (ADR-0058):** assumes block-lattice coordinates with possible reorgs. Off-chain APIs have no reorg concept. The `confirmedHead = tip − headLag` model has no analogue.
- **`seen_log` two-layer idempotency (ADR-0063):** `seen_log` records `(chainId, txHash, logIndex, blockNumber, blockHash)` — EVM-only coordinates. Off-chain entities are identified by source-native string ids, not tx coordinates.
- **4-tuple `ON CONFLICT` (ADR-0041):** `(source_type, chain_id, tx_hash, log_index)` is the unique identity key in `archive_event`. Off-chain events have no tx_hash or log_index.
- **Single-worker-per-`(chain_id, source_type)` invariant (ADR-0058 amendment):** still holds — each poll source has its own driver/timer, and the off-chain consumer will use `localConcurrency = 1`.

---

## Poll transport scaffold (Accepted)

### Decision

Add a third `IngestSpec` variant, `{ kind: 'poll'; listener: PollListener<TCursor> }`, to the discriminated union. The orchestrator dispatches on `spec.kind`; poll specs skip the `ChainConfig` lookup and the EVM catch-up branch.

### `PollListener<TCursor>` contract

```ts
interface PollListener<TCursor = unknown> {
  readonly intervalMs: number;
  /** MUST thread ctx.signal into its HTTP client — see per-tick deadline below. */
  poll(ctx: PollPollContext, cursor: TCursor | null): Promise<PollResult<TCursor>>;
}
```

`TCursor` is **partition-aware** — it is the plugin's responsibility to encode per-partition state (Snapshot: `{ space, createdGte, skip }`; Discourse: `{ category, page, streamPos }`). A scalar `string` cursor would break when a source polls multiple partitions.

### `PollSourcePoller` — `AbstractPoller` subclass

`PollFetchDriver.start()` instantiates a `PollSourcePoller extends AbstractPoller`. The base class provides:

- **Single-flight re-entry guard** — a slow `poll()` cannot overlap the next scheduled tick.
- **Terminal-after-stop** — a stopped instance cannot be restarted.
- **Immediate first tick** — the poller ticks synchronously on `start()` before installing the interval.
- **Hard `stopTimeoutMs` race** — `stop()` waits at most `stopTimeoutMs` (default 5 s) for any in-flight tick to settle, then returns unconditionally. A hung `poll()` cannot deadlock `drain()`/`onApplicationShutdown()`.

### Per-tick deadline + cooperative abort contract

Each `runTick()` creates a per-tick `AbortController`, starts a `POLL_TICK_TIMEOUT_MS` (default 30 s) timeout that aborts it, and races `poll(ctx, cursor)` against the abort signal via `raceWithAbort`. When the deadline fires the abort signal is aborted and `raceWithAbort` throws, causing `runTick()` to return.

**Contract (binding on all `PollListener` implementations):** `poll()` MUST thread `ctx.signal` into its HTTP client. A bare `await fetch(url)` ignores the signal; `await fetch(url, { signal: ctx.signal })` honours it. Failure to thread the signal means the underlying HTTP call leaks after timeout rather than being cancelled — not a correctness failure (the tick still returns via `raceWithAbort`) but a resource waste.

### `contentHash` constraint

`PollItem.contentHash` is computed in the plugin's `poll()` over the **raw poll-response slice** for that item. The poll/list query therefore **MUST select every field that the off-chain consumer's mutable-latest edit-detection diffs on**. If an edit-salient field is only available via a per-item detail fetch, the `contentHash`-at-list-time model breaks and the driver would need an additional fetch stage.

- This constraint is **owned by the Snapshot and Discourse ingester implementations**.
- ADR-071 states it; they must honour it.

### In-memory cursor + enqueue-port guardrail

`PollSourcePoller` holds `cursor` in memory only. On restart the cursor resets to `null`, causing re-fetch from genesis. This is safe **only** because `PollEnqueuePort` is currently bound to a no-op stub. The real enqueue port **MUST NOT be bound** until:

1. `archive_event` gains `external_id` + nullable block coords + the `(source_type, external_id)` partial unique index (the idempotency layer that makes re-fetch from genesis harmless).
2. Cursor persistence lands (off-chain watermark), so restarts resume rather than re-fetch.

Binding the real port before both of those land would cause a duplicate-enqueue flood on every restart.

### `FetchDriver<K>` per-kind `chainCfg` typing

`FetchDriver` is typed as a conditional type so EVM arms (`evm-event-poller`, `evm-block-head-poller`) keep `chainCfg: ChainConfig` as required, while the `poll` arm omits it entirely. This prevents TypeScript from silently accepting a missing `chainCfg` on EVM drivers.

### Metrics

`poll_tick_total{source_type, result}` (ok|error|timeout), `poll_items_enqueued{source_type}`, and `poll_last_success_unixtime{source_type}` (staleness gauge) are emitted from `PollSourcePoller.runTick()`. A silently-failing poll source is immediately observable.

---

## Off-chain `archive_event` identity (Accepted)

Ratified and implemented in [#318](https://github.com/EugeneButusov/kvorum/issues/318). Since the project is pre-production, the `archive_event` schema carries the final shape directly in `0002_core_domain` rather than via an ALTER migration.

### Decision — two identity shapes, one table

`archive_event` carries both EVM and off-chain rows, distinguished by a single nullable column:

- `block_number` / `block_hash` / `tx_hash` / `log_index` become **nullable**.
- New column `external_id text` — the source-native id (Snapshot proposal hash, Discourse topic id).
- A **CHECK** (`archive_event_identity_shape`) enforces exactly one shape: an EVM row has the full
  4-tuple and `external_id IS NULL`; an off-chain row has `external_id` set and all four coords NULL.
- The idempotency index splits into **two partial unique indexes**:
  - `archive_event_idempotency_key (source_type, chain_id, tx_hash, log_index) WHERE external_id IS NULL` (EVM, unchanged columns + predicate).
  - `archive_event_external_id_key (source_type, chain_id, external_id) WHERE external_id IS NOT NULL` (off-chain).
- Off-chain rows carry the sentinel `chain_id = 'off-chain'` (consistent with Z0; part of the
  off-chain unique tuple; keeps `countUnderivedBySourceType`'s `GROUP BY chain_id, source_type` valid).
- `insert()` binds the matching index predicate in its `ON CONFLICT` target so Postgres infers the
  correct partial index per shape. Both shapes use `DO NOTHING` — **mutable-latest re-archive on
  content change is the consumer's job (below), not Z1's.**

### Decision — query-level segregation keeps the EVM read path untouched (D1)

`ArchiveDerivationRow` (the projection/actor-sweep read shape) types its coords as **non-null** and is
consumed by ~30 EVM projection appliers + the actor-sweep service, each building a join key
`` `${chain_id}:${tx_hash}:${log_index}:${block_hash}` ``. Rather than widen those coords to nullable
(which would force a narrowing into all ~30 load-bearing sites for a path off-chain rows never take),
the three EVM-shaped read queries (`findUnderived`, `findDerivableBy`, `findUnresolvedActors`) gain a
`WHERE external_id IS NULL` predicate. Combined with the CHECK, that **guarantees** the returned rows
have non-null coords, so `ArchiveDerivationRow` stays non-null and **zero** EVM consumers change. The
nullable table type narrows to the non-null row type via a single documented cast co-located with each
predicate.

### Decision — off-chain ordering and the actor-sweep join key

Off-chain rows get a **parallel read path** mirroring the segregation above, so they never collide with
the non-null EVM type:

- A nullable `derivation_ordinal bigint` column carries the **source-native ordinal** that gives
  blockless rows a deterministic derivation order (the EVM `(block_number, log_index)` key is
  degenerate off-chain). It is NULL for EVM rows. The off-chain read methods (`findUnderivedOffchain`,
  `findDerivableByOffchain`, `findUnresolvedActorsOffchain`) select `external_id IS NOT NULL` and order
  by `(chain_id, derivation_ordinal, external_id, id)`, returning the `OffchainArchiveRow` shape.
- The actor-sweep correlation key (`archiveRowKey`) is **external-id-aware**: off-chain rows key on
  `${chain_id}:ext:${external_id}`, EVM rows keep the `${chain_id}:${tx_hash}:${log_index}:${block_hash}`
  4-tuple (byte-for-byte unchanged). This prevents the degenerate `...:null:null:null` collision across
  off-chain rows of one source.

The **value semantics** of `derivation_ordinal` (e.g. Snapshot vote-hash + `created`) are defined in
ADR-072; Z1 provides the column, the ordering, and the key. **Wiring** these read methods into the
derivation worker / actor-sweep service dispatch (and the per-source off-chain adapters) lands with the
off-chain derivers (AD2/AD4) — Z1 ships the infrastructure, not the protocol consumers.

### Deferrals (scope boundary)

- **Mutable-latest** re-archive on `(external_id, contentHash)` change → the consumer section below.
- **Off-chain consumer wiring** (derivation-worker dispatch + per-source actor-sweep adapters that call
  the off-chain read methods) → **AD2 / AD4**, where a real off-chain deriver consumes them.
- **Off-chain DLQ shape** (an `archive_external_id` column on `ingestion_dlq`) → the consumer section;
  `ingestion_dlq` is untouched here.

---

## Off-chain consumer and mutable-latest semantics (Accepted)

Ratified and implemented in [#319](https://github.com/EugeneButusov/kvorum/issues/319). This is the half that **binds the real `QueueProducerPort`** — both guardrail halves (Z1 `external_id` idempotency + Z2 cursor persistence) are now satisfied.

### Producer + cursor (atomic per-tick commit)

The reshaped `QueueProducerPort` exposes `loadCursor(source)` and `commitTick(source, items, nextCursor)`. `commitTick` opens **one** PG transaction: `boss.send(off_chain_archive, job, { db: trx })` for each item, then upserts `off_chain_cursor(dao_source_id, cursor)`, then commits — **all-or-nothing**. The cursor advances only if the jobs are durably enqueued; a crash re-fetches (idempotent at the consumer) rather than skips (at-least-once). The poller seeds its cursor from `loadCursor` before the immediate first tick. Cursor persistence lives in its own `off_chain_cursor` table (not `dao_source.source_config` — runtime watermark vs operator config).

### Consumer (resolve by daoSourceId, no decode, mutable-latest)

A worker on `off_chain_archive` (`localConcurrency: 1`) resolves the source by **`daoSourceId`** (the job carries it; no `(chain, address)` — off-chain has no address), skips ABI decode (the raw `payload` is the archive payload), and dispatches by `sourceType` to a per-source CH writer (`buildOffChainArchiveWriter`). The PG watermark + mutable-latest decision are owned by the generic consumer; the per-source seam writes only CH.

**Mutable-latest with a monotonic `version`.** Per job, `findByExternalId` returns `{ id, content_hash, version }`:

- **unchanged** (`content_hash` equal) → **skip** (the at-least-once safety net for re-delivery, not just efficiency);
- **new** → `version = 1`, CH write, PG insert;
- **edited** → `version = existing.version + 1`, CH write, then a **CAS** PG update `… WHERE version < :version` that also resets **all four** derivation watermarks (`derived_at`, `derivation_actor_resolved_at`, `derivation_attempt_count`, `actor_resolution_attempt_count`) so the edit is re-resolved and re-derived from scratch.

`version` is **PG-maintained** (bumped only on content change), and is the CH `ReplacingMergeTree(version)` sort key so the latest edit wins deterministically. This is self-contained (no reliance on a source-native monotonic field), retry-idempotent (a retry recomputes the same version from unchanged PG state), and the CAS guard makes an out-of-order older edit a no-op.

### Binding constraint on Z3

The per-source off-chain CH table (`event_archive_snapshot`, Z3) **MUST** be `ReplacingMergeTree(version)` — **not** the existing `received_at` convention, which is second-precision and would non-deterministically drop a same-second edit. Z2 ships a synthetic in-memory CH writer; Z3 inherits the obligation to re-run the mutable-latest end-to-end against the real table (asserting `SELECT … FINAL` returns the edit, and a CH-insert failure routes to DLQ without advancing the PG watermark).

### DLQ

`off_chain_archive` has `deadLetter`/`retryLimit`; an `OffChainArchiveDlqBridge` drains dead-lettered jobs into `ingestion_dlq`. Transient CH/PG errors throw → retry → dead-letter; a malformed/unmapped job acks into the DLQ without burning retries. `ingestion_dlq` is unchanged — the off-chain identity (`external_id`, etc.) is carried in the row's `payload` jsonb rather than adding an `archive_external_id` column.

---

## Z3 binding constraint satisfied (Accepted)

Ratified and implemented in [#320](https://github.com/EugeneButusov/kvorum/issues/320).

`archive_event_snapshot` was created in `libs/sources/snapshot/migrations-clickhouse/0008_snapshot_archive.sql` as:

```sql
ENGINE = ReplacingMergeTree(version)
ORDER BY (dao_source_id, external_id);
```

This satisfies the §Off-chain consumer binding constraint: `version` (Int32, mirroring PG `archive_event.version`) is the sort key — `SELECT … FINAL` returns the row with the greatest version per `(dao_source_id, external_id)` regardless of insertion order, making same-second edits deterministic. The `received_at` convention (second-precision) was intentionally **not** used.

A minimal round-trip test (`tests/snapshot-archive-round-trip.integration.spec.ts`) proves deduplication: insert v1 → insert v2 same key → `SELECT … FINAL` returns exactly the v2 row.

The full DLQ-on-CH-failure end-to-end remains with AD1 as stated.

---

## Amendment (2026-07-04) — bounded off-chain backfill drain

The poll transport was built as a **perpetual** interval loop (`PollSourcePoller`): it never terminates,
because live ingestion never "finishes." A from-genesis **backfill** needs a bounded run, so a drain
driver in `admin-cli` (`runOffChainDrain`) runs over the same `PollListener` + `off_chain_cursor` +
`QueueProducerPort` seam, with three additions:

- **Inferred termination (quiescence).** `PollResult` deliberately carries no `done`/`caughtUp` flag
  (§Poll transport scaffold), so the drain infers completion: it stops after **K consecutive ticks**
  (default 3) that both return zero items **and** leave the cursor unadvanced. A single sparse tick does
  not stop the run; the counter resets whenever a tick yields items or advances the cursor. The
  conservative default trades a few extra polls near the head for safety against a premature stop at a
  transient gap. The later live full-history run validates true completeness against a pinned Snapshot
  snapshot.
- **Forward-only.** The Snapshot closed-proposal reconcile (`staleProviderFactory`) and the Discourse
  periodic re-crawl (`reconcileIntervalMs`) are omitted for the bounded sweep — those are live-mode
  concerns. A backfill sweeps history once.
- **Two sinks behind `QueueProducerPort`.** The default **enqueue** sink commits ticks to the
  `off_chain_archive` pg-boss queue (the running consumer applies mutable-latest); the **`--direct`**
  sink applies mutable-latest in-process for a self-contained CLI run. Both reuse the **same
  `applyOffChainMutableLatest` routine** extracted from the Nest consumer into `@sources/core`, so the
  live and backfill paths cannot drift. The drain is `SIGINT`/`SIGTERM`-cancellable (ADR-047) and
  resumable via the persisted cursor.

The single-worker-per-source invariant still holds: the drain is single-flight, and `--direct` writes
serially per source.

## Alternatives considered

- **Separate `SourceIngester` field** (e.g. `isOffChain: boolean`) for detection — rejected in favour of `spec.kind` dispatch. The driver dispatch axis already exists; a boolean field would be redundant and require changes to every plugin.
- **Scalar `PollCursor = string`** — rejected. Snapshot needs `{ space, createdGte, skip }` and Discourse needs `{ category, page, streamPos }`. A scalar forces a breaking `IngestSpec` change in AD/AE.
- **Widening `FetchDriver.start` chainCfg to optional** globally — rejected. It would stop TypeScript from flagging a missing chainCfg on EVM drivers.
- **Hand-rolling the timer lifecycle** — rejected. `AbstractPoller` already implements the exact lifecycle with the verified `stopTimeoutMs` race; reimplementing it worse was a blocker found in the adversarial review (rev2).

---

## Amendment (AD2, 2026-06-30) — off-chain derivation dispatch

Z shipped the off-chain archive identity + selection repo methods (`findUnderivedOffchain`,
`findDerivableByOffchain`, `findUnresolvedActorsOffchain`) but nothing consumed them. AD2 — the first
off-chain projection (Snapshot proposals) — wires the derivation side, mirroring the EVM model:

- **Two new parallel deriver interfaces** in `@sources/core`: `OffchainProjectionDeriver`
  (`kind: 'offchain-projection'`, `applyBatch(OffchainArchiveRow[])`) and `OffchainActorAddressDeriver`
  (`kind: 'offchain-actor-address'`). Kept separate from the EVM `ProjectionDeriver`/`ActorAddressDeriver`
  rather than widening their `ArchiveDerivationRow` signatures to a union — widening would reject the
  four concrete EVM derivers' narrow types at the `derivation.module` adapter-assignment site.
- **Both workers gain an additive off-chain pass.** The derivation worker calls `findDerivableByOffchain`
  and the actor-sweep `findUnresolvedActorsOffchain`; off-chain rows are matched to CH payloads by
  `external_id` (not the block 4-tuple). The uniform actor-resolution gate is preserved — off-chain rows
  derive only after the actor-sweep sets `derivation_actor_resolved_at`. EVM dispatch is byte-for-byte
  unchanged (regression tests assert this).
- **Mutable-latest re-derivation** rides the existing watermark reset: an edit bumps `version` + resets
  `derived_at`/`derivation_actor_resolved_at`, so the row re-sweeps then re-derives. The off-chain
  projection applier reads the **max-version** CH payload and re-sets derivation-owned state via the
  guard-bypass `ProposalRepository.setStateFromDerivation` (state is a pure function of the latest
  payload, replay-safe — same rationale as the Lido DG applier).
