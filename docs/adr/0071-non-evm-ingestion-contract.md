# ADR-071 — Non-EVM ingestion contract

**Status:** Poll transport + off-chain identity sections Accepted; consumer section Directional (to be ratified at implementation)
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
predicate. Off-chain derivation/actor-sweep read methods are added when a consumer exists (AD2/AD4).

### Deferrals (scope boundary)

- **Mutable-latest** re-archive on `(external_id, contentHash)` change → the consumer section below.
- **Off-chain derivation ordinal** (deterministic proposal/vote order; the EVM `(block_number,
log_index)` key is degenerate off-chain) → **ADR-072 / Z4**, which defines the Snapshot vote
  ordering key (vote-hash + `created`). Z1 only guarantees the existing EVM ordering is unperturbed.
- **Off-chain derivation / actor-sweep read path** (off-chain row type + queries + an external-id join
  key) → **AD2 / AD4**, where a real off-chain deriver consumes them.
- **Off-chain DLQ shape** (an `archive_external_id` column on `ingestion_dlq`) → the consumer section;
  `ingestion_dlq` is untouched here.

---

## Off-chain consumer and mutable-latest semantics (Directional — to be ratified at implementation)

> This section records intent only. The exact payload shape, consumer dispatch, and CH write logic will be finalised when [#319](https://github.com/EugeneButusov/kvorum/issues/319) is implemented.

- The off-chain consumer resolves by `daoSourceId` (not `(chain, address)` — off-chain sources have no contract address).
- No ABI decode step; the raw `PollItem.payload` is the archive payload.
- **Mutable-latest semantics:** re-archive on `(external_id, contentHash)` change. An off-chain entity (Snapshot proposal) can be edited; the archive must reflect the latest version. Unlike EVM events (`ON CONFLICT DO NOTHING`), off-chain writes update on content change.
- CH-first then PG watermark write, following the ADR-041 protocol where applicable.
- Cursor is persisted (off-chain watermark table or `dao_source.source_config` amendment) so restarts resume rather than re-fetch.
- `localConcurrency: 1` on the off-chain consumer queue — the single-worker-per-source invariant holds.

---

## Alternatives considered

- **Separate `SourceIngester` field** (e.g. `isOffChain: boolean`) for detection — rejected in favour of `spec.kind` dispatch. The driver dispatch axis already exists; a boolean field would be redundant and require changes to every plugin.
- **Scalar `PollCursor = string`** — rejected. Snapshot needs `{ space, createdGte, skip }` and Discourse needs `{ category, page, streamPos }`. A scalar forces a breaking `IngestSpec` change in AD/AE.
- **Widening `FetchDriver.start` chainCfg to optional** globally — rejected. It would stop TypeScript from flagging a missing chainCfg on EVM drivers.
- **Hand-rolling the timer lifecycle** — rejected. `AbstractPoller` already implements the exact lifecycle with the verified `stopTimeoutMs` race; reimplementing it worse was a blocker found in the adversarial review (rev2).
