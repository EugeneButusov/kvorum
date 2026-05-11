# M1 — Epic F, Task F1 — execution plan

**Status:** draft, awaiting approval — implementation does not start until this lands explicitly
**Owner:** Eugene
**Date:** 2026-05-11
**Issue:** [#29 — F1. Compound Governor adapter + archive writer (polling, idempotent)](https://github.com/EugeneButusov/kvorum/issues/29)
**Epic:** [#44 — Epic F — Compound Governor ingestion + reorg handling](https://github.com/EugeneButusov/kvorum/issues/44)
**Milestone:** [M1 — Compound proposals end-to-end](https://github.com/EugeneButusov/kvorum/milestone/2)
**Estimated effort:** ~11h (decode ~1.5h · archive writer ~3h · NestJS wiring ~3h · metrics ~0.5h · tests ~2h · Anvil integration F1-anvil-1/2/3 ~0.5h · CH migration amendment + runbook ~0.5h)
**Spec / ADR references:** SPEC §3.3 (EVM source ingestion), §3.4 (confirmation lifecycle), §3.12 (DLQ + metric families), ADR-037 (polling-only), **ADR-041 + 2026-05-11 rider §1/§3/§4 + 2026-05-12 retraction of §2** (cross-DB integrity contract — see `docs/adr/0041-cross-db-integrity-contract.md` §Rider), ADR-032 (DLQ accept semantics), ADR-038 (CH archive layer), ADR-039 (Compound choices)

---

## Why this task, why now

F1 is the first task that crosses the boundary from chain-lib infrastructure (E1–E4) to a real consuming application. Up until now `libs/chain` has been verified by unit + Anvil-integration tests on synthetic shapes; F1 wires those primitives to:

- A real contract (mainnet GovernorBravoDelegator at `0xc0Da02939E1441F497fd74F78cE7Decb17B66529`)
- A real schema (`event_archive_compound_governor` CH table + `archive_confirmation` PG control plane)
- A real write protocol (the PG-first existence check + CH-then-PG order from ADR-041)

The result is a `apps/indexer` process that can be pointed at Ethereum mainnet and produces `event_archive_compound_governor` rows for `ProposalCreated` / `ProposalQueued` / `ProposalExecuted` / `ProposalCanceled` within ~12 s of block confirmation. **Pending only** — promotion to `confirmed` (F2) and reorg orphaning (F2) and the Anvil synthetic-reorg test (F3) are downstream.

F1 is the highest-LOC task in Epic F (E3-style polling already exists; this builds the first ingester _on top_). F2 and F3 are smaller because F1 carries the schema-touching weight.

---

## Current state — what E1–E4 already provide

This grounds the design. None of these need to be touched in F1.

- **`libs/chain/src/poller/event-poller.ts`** — `EventPoller` polls `eth_getLogs` over a sliding `2 × reorgHorizon` block window every 12 s, decodes raw responses into `LogEvent` (lowercased addresses, BigInt block numbers), dispatches to registered listeners via `Promise.allSettled`. Tick-drop guard, metrics already plumbed. Cold-start gap is **documented** in the poller but deliberately **not filled** there — backfill (Epic I) owns cold-start fill. F1 inherits the same boundary. **F1 instantiates one EventPoller per `dao_source`** of type `compound_governor`.
- **`libs/chain/src/client/failover-rpc-client.ts`** — `FailoverRpcClient.send<T>(method, params, opts?)` with circuit breaker, multi-provider failover, chain-id verification, prom metrics. **F1 reuses, one per chain.**
- **`libs/chain/src/config/config.ts`** — `parseChainConfigFromEnv(env)` returns validated `ChainConfig[]` from `CHAIN_CONFIG` JSON env var. Schema covers `chainId`, `name`, `reorgHorizon`, `lagThresholdBlocks`, `overallTimeoutMs`, and per-provider `{ name, url, kind, priority, timeoutMs, dailyQuota }`.
- **`libs/chain/src/poller/utils/idempotency.utils.ts`** — `buildIdempotencyKey({ sourceType, chainId, txHash, logIndex, blockHash })` — already aligned with the 5-tuple PG unique index `archive_confirmation_idempotency_key`. Hex normalisation, lowercase. **F1 uses this for log lines and metric labels; the actual PG `WHERE` clause uses the 5 columns directly because Kysely speaks columns.**
- **`libs/chain/src/poller/types.ts`** — `LogEvent` shape (`sourceType`, `chainId`, `blockNumber: bigint`, `blockHash`, `txHash`, `txIndex`, `logIndex`, `address`, `topics`, `data`). Decoded form ready for F1's decoder.
- **`libs/db/src/client.ts`** — `pgDb` (Kysely + pg pool) and `chDb` (`@founderpath/kysely-clickhouse`). Both are module-level singletons. `pgDb.destroy()` belongs in the indexer's `OnApplicationShutdown` hook (per CLAUDE.md NestJS workers section).
- **PG schema (E1)** — `archive_confirmation` table with `archive_confirmation_idempotency_key UNIQUE (source_type, chain_id, tx_hash, log_index, block_hash)`, partial unique index `idx_archive_confirmation_canonical` over canonical rows, `idx_archive_confirmation_dao_source` for source-scoped queries. `ingestion_dlq` table with `stage TEXT NOT NULL`, typed archive-tuple columns (5 nullable columns as a group), `idx_ingestion_dlq_archive_tuple` partial index.
- **CH schema (E1, amended by F1)** — `event_archive_compound_governor` ReplacingMergeTree(received_at). E1 shipped with `PARTITION BY (chain_id, intDiv(block_number, 1000000))`, `ORDER BY (dao_source_id, chain_id, block_number, tx_hash, log_index, block_hash)`, bloom-filter index on `tx_hash`, payload `String CODEC(ZSTD(3))`. F1 amends this migration before any production deployment — see **§F1f — CH migration amendment** below for the new schema (PARTITION BY chain_id, ORDER BY without dao_source_id, codecs on numerics/hex/UUID, server-stamped DateTime received_at). The amendment lands in the same PR; M1 has not yet pointed at a production CH instance, so the migration file is edited in-place.
- **`libs/db` typed schemas** — `NewArchiveConfirmation`, `NewIngestionDlq`, `NewEventArchiveCompoundGovernor`, `ConfirmationStatus` union (`'pending' | 'confirmed' | 'orphaned'`), `SourceType` (string alias keyed by reference table).
- **`libs/sources/compound/src`** — `COMPOUND_PROPOSAL_CHOICES` (ADR-039 enum), re-exports archive types. Existing module — F1 extends with the event ABI.
- **`apps/indexer/src/`** — boots `NestFactory.createApplicationContext` with `AppModule { providers: [ShutdownLogger] }` and `enableShutdownHooks()`. **No source modules yet.** F1 introduces the first.

What `package.json` pins relevant here: **ethers v6** (event log decoding via `Interface.parseLog`), **Kysely** (PG + CH builders), **NestJS 11** (DI + lifecycle hooks), **prom-client** (metrics, already integrated via `getChainMetricsRegistry()`).

`viem` is **not** used (per E2/E3/E4 precedent — overridden plan-m1.md's draft recommendation; ethers v6 chosen). F1 follows the same convention. Event ABI uses ethers `Interface`; RPC calls go through `rpcClient.send` directly (already the case for EventPoller).

---

## Deliverables overview

Six sub-deliverables, mirroring the E4a/b/c convention:

| ID  | Title                                                                                                                                                 | Module                                                                                           | Estimate |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| F1a | Compound Governor event ABI fragment + decoder                                                                                                        | `libs/sources/compound/src/governor/events.ts` + `decoder.ts`                                    | ~1.5h    |
| F1b | Cross-DB archive writer (ADR-041 protocol: PG check → CH insert → PG insert → DLQ; CH errors propagate to listener) — plain class with ctor-DI        | `libs/sources/compound/src/governor/archive-writer.ts` + `ingester-listener.ts`                  | ~3h      |
| F1c | NestJS source module + bootstrap service (apps/indexer wrapper): consumes lib primitives via `useFactory`; owns DI, drainable, per-chain client share | `apps/indexer/src/sources/compound-governor/` (thin)                                             | ~3h      |
| F1d | Pending-depth gauge + writer/DLQ/CH-error/decode/active-sources counters + batch-duration histogram                                                   | `libs/chain/src/metrics/metrics.ts` + lib writer/listener + apps/indexer service instrumentation | ~0.5h    |
| F1e | Unit + Anvil integration tests                                                                                                                        | spec files colocated with each module (lib specs use Vitest; Nest service spec uses Jest)        | ~2h      |
| F1f | CH migration amendment (PARTITION BY, ORDER BY, codecs, server-stamped received_at)                                                                   | `libs/sources/compound/migrations-clickhouse/compound_001_archive.sql` + runbook                 | ~0.5h    |

Total ≈ 10.5h coding + ~0.5h CI/PR wrap.

---

## F1a — Event ABI fragment + decoder

### Scope

A pure function `decodeCompoundLog(log: LogEvent): CompoundGovernorEvent` that takes a normalised `LogEvent` from `EventPoller` and returns a typed Compound Governor event with payload pre-shaped for JSONB insertion. No I/O. No throw paths besides "unknown topic0 / malformed args" (F1b decides whether to DLQ or drop).

### Module layout

```
libs/sources/compound/src/
  governor/
    events.ts               — ABI fragment (4 events) + Interface singleton + topic0 constants
    events.spec.ts          — vitest unit tests for decoding + payload normalisation
    decoder.ts              — decodeCompoundLog(log) → CompoundGovernorEvent (typed union)
    decoder.spec.ts         — vitest tests for the four event variants + error paths
    types.ts                — CompoundGovernorEvent union, *Payload interfaces, DecodeError
    index.ts                — governor-subpackage public surface
  index.ts (updated)        — re-export from `./governor` + existing proposal-choices/types
```

**Why `libs/sources/compound/src/governor/` and not `apps/indexer/src/sources/compound-governor/abi.ts`** (the path the issue text hints at): the libs/sources/<source> directory is already the canonical home for compound migrations + types + ADR-039 choice mapping. Putting the event ABI here keeps source-specific knowledge in one package and avoids a re-home when (a) the backfill driver (Epic I) needs the same decoder and (b) G2's ABI library wants to call into the same `Interface`. The `apps/indexer` module imports from `@libs/sources-compound`; no duplication. The `governor/` subdirectory keeps room for future contract-kind siblings (Comptroller, etc.) without flattening unrelated symbols into the package root. The decision is reversible (open question OQ-F1-1 below) but the lib home is the right one.

### ABI fragment (`events.ts`)

The four Compound `GovernorBravoDelegate` events, transcribed verbatim:

```ts
export const COMPOUND_GOVERNOR_EVENTS = [
  'event ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
  'event ProposalQueued(uint256 id, uint256 eta)',
  'event ProposalExecuted(uint256 id)',
  'event ProposalCanceled(uint256 id)',
] as const;

export const COMPOUND_GOVERNOR_INTERFACE = new Interface(COMPOUND_GOVERNOR_EVENTS);

// Pre-computed topic0s (keccak256 of the canonical event signature). Lowercased.
// Computed at module load via Interface.getEventTopic(name); cached as constants for
// EventPoller filter composition + decoder dispatch.
export const COMPOUND_EVENT_TOPICS = {
  ProposalCreated: COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalCreated')!.topicHash.toLowerCase(),
  ProposalQueued: COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalQueued')!.topicHash.toLowerCase(),
  ProposalExecuted:
    COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!.topicHash.toLowerCase(),
  ProposalCanceled:
    COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalCanceled')!.topicHash.toLowerCase(),
} as const;

export type CompoundEventType = keyof typeof COMPOUND_EVENT_TOPICS;
```

**Why `topicHash` and not a hardcoded constant**: ethers v6's `Interface` derives the topic at construction; copying the 32-byte hashes in by hand is a copy-paste hazard that costs nothing to avoid. A regression test asserts the four computed topics match the well-known canonical values (e.g. `ProposalCreated = 0x7d84a6263ae0d98d3329bd7b46bb4e8d6f98cd35a7adb45c274c8b7fd5ebd5e0`).

### Decoder API

```ts
export type CompoundGovernorEvent =
  | { type: 'ProposalCreated'; payload: ProposalCreatedPayload }
  | { type: 'ProposalQueued'; payload: ProposalQueuedPayload }
  | { type: 'ProposalExecuted'; payload: ProposalExecutedPayload }
  | { type: 'ProposalCanceled'; payload: ProposalCanceledPayload };

export interface ProposalCreatedPayload {
  proposalId: string; // uint256 → decimal string
  proposer: string; // 0x… lowercased
  targets: string[]; // each lowercased
  values: string[]; // uint256 → decimal string each
  signatures: string[];
  calldatas: string[]; // 0x… hex
  startBlock: string; // uint256 → decimal string
  endBlock: string; // uint256 → decimal string
  description: string;
}

export interface ProposalQueuedPayload {
  proposalId: string;
  eta: string;
}
export interface ProposalExecutedPayload {
  proposalId: string;
}
export interface ProposalCanceledPayload {
  proposalId: string;
}

/** Throws DecodeError on unknown topic0 or mismatched arg count.
 *  Caller (F1b) catches → DLQ with stage='archive_decode'. */
export function decodeCompoundLog(log: LogEvent): CompoundGovernorEvent;

export class DecodeError extends Error {
  constructor(
    public readonly reason: 'unknown_topic' | 'parse_failed' | 'wrong_address',
    public readonly cause: unknown,
    public readonly logRef: { txHash: string; logIndex: number; blockHash: string },
  ) {
    super(`decode failed: ${reason}`);
  }
}
```

### Payload normalisation rules

| ABI type  | JSON shape                      | Rationale                                                                                                                                                                                       |
| --------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uint256` | decimal string                  | JSON has no bigint; decimal string preserves the full uint256 range and is human-readable; matches PG `numeric(78, 0)` in `proposal_action.value_wei` (Kysely returns string for bigint anyway) |
| `address` | lowercased `0x…` hex string     | matches `LogEvent.address` normalisation; matches PG `text` columns                                                                                                                             |
| `bytes`   | `0x…` hex string                | always even-length; preserves binary content without base64 ambiguity                                                                                                                           |
| `string`  | UTF-8 string                    | descriptions may include emoji, markdown, occasional control chars — pass-through unchanged (PG `text` + CH `String` both UTF-8)                                                                |
| arrays    | JSON array of normalised values | preserves index ordering for action_index alignment in G1                                                                                                                                       |

**Array element conversion is explicit.** ethers v6's `Interface.parseLog` returns a `Result` whose array entries retain their native JS type — `bigint` for `uint256[]`, `string` for `address[]`/`bytes[]`/`string[]`. The decoder must walk each array element-by-element:

```ts
// Inside the ProposalCreated branch:
const args = parsed.args;
return {
  type: 'ProposalCreated',
  payload: {
    proposalId: args.id.toString(),
    proposer: (args.proposer as string).toLowerCase(),
    targets: (args.targets as string[]).map((a) => a.toLowerCase()),
    values: (args.values as bigint[]).map((v) => v.toString()),
    signatures: args.signatures as string[],
    calldatas: args.calldatas as string[],
    startBlock: args.startBlock.toString(),
    endBlock: args.endBlock.toString(),
    description: args.description as string,
  },
};
```

Forgetting the `.map((v) => v.toString())` on bigint arrays produces an in-memory `BigInt[]`, which crashes `JSON.stringify` later in F1b. Spec test #6 covers this for the scalar case; an additional test covers arrays.

The decoder never throws on legitimate Compound payloads (verified by replaying a sample of historical proposals as a unit-test fixture). It throws only when the EventPoller emitted a log whose topic0 doesn't match the four filter topics (a logic bug in the filter setup) or whose ABI-decoded arg list doesn't match the interface (a corrupted log or a malformed RPC response).

### Tests (`decoder.spec.ts`)

| #   | What it asserts                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ProposalCreated` fixture log (from real mainnet proposal, hex-dumped) decodes to a payload with the expected proposalId/proposer/targets/values/signatures/calldatas/startBlock/endBlock/description |
| 2   | `ProposalQueued` decode: proposalId + eta as decimal strings                                                                                                                                          |
| 3   | `ProposalExecuted` decode: single-field payload                                                                                                                                                       |
| 4   | `ProposalCanceled` decode: single-field payload                                                                                                                                                       |
| 5   | Address normalisation: mixed-case proposer in topics decodes lowercased                                                                                                                               |
| 6   | uint256 boundary: a value of `2^256 - 1` survives the round-trip as decimal string                                                                                                                    |
| 7   | Description with UTF-8 emoji + leading whitespace + markdown survives unchanged                                                                                                                       |
| 8   | Unknown topic0 → throws `DecodeError({ reason: 'unknown_topic' })`                                                                                                                                    |
| 9   | Topic0 matches but data hex is truncated → throws `DecodeError({ reason: 'parse_failed' })`                                                                                                           |
| 10  | Topic-hash assertion: the four computed topic0s match a hard-coded reference set (regression guard against ethers v6 upgrades)                                                                        |

### Decisions captured (F1a)

| #       | Decision                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-F1a-1 | ABI fragment lives in `libs/sources/compound`, not `apps/indexer`. Single canonical home; no duplication when Epic I (backfill) reuses the decoder                   |
| D-F1a-2 | Topic0 constants derived from `Interface.getEvent(name).topicHash` (not hand-typed). Regression test asserts the values                                              |
| D-F1a-3 | Payload normalisation: bigints → decimal strings; addresses lowercased; bytes hex-prefixed. Aligned with PG numeric-as-string and CH String conventions              |
| D-F1a-4 | `decodeCompoundLog` throws `DecodeError` rather than returning `null`. F1b catches and routes to DLQ — separates "did we get a wrong log" from "is the payload null" |
| D-F1a-5 | No address filtering inside the decoder. EventPoller's filter already constrains `address` to the governor contract; a defensive check here would be redundant       |
| D-F1a-6 | No `viem` — ethers v6 `Interface` already in deps; matches E2/E3/E4 precedent                                                                                        |

---

## F1b — Cross-DB archive writer (ADR-041 protocol)

### Scope

A pure-function-shaped service: `writeArchiveEvent(daoSource, decoded, logRef)` that follows ADR-041 verbatim:

1. **PG existence check** by 5-tuple
2. **CH insert** (idempotent via ReplacingMergeTree)
3. **PG insert** with `ON CONFLICT DO NOTHING` + 3-attempt × exponential backoff (200 / 600 / 1800 ms)
4. **DLQ on persistent PG failure**: `stage='archive_confirmation_write'`, typed 5-tuple columns populated, payload = the original event blob
5. **DLQ-insert failure** (PG unreachable for the DLQ table too): increment `kvorum_dual_write_pg_unreachable_total`, log error, abort the worker tick (next poll re-runs step 1 and finds the CH row already present)

No HTTP. No NestJS-specific shape — accepts dependencies (`pgDb`, `chDb`, logger) by constructor. Testable in isolation.

### Module layout

```
libs/sources/compound/src/governor/
  archive-writer.ts           — class ArchiveWriter (plain class; constructor-injected deps; no @Injectable)
  archive-writer.spec.ts      — vitest unit tests with mocked PG + CH
  ingester-listener.ts        — makeIngesterListener(deps) → EventsListener factory
  ingester-listener.spec.ts   — vitest listener tests
```

**Framework-agnostic on purpose.** `ArchiveWriter` is a plain TypeScript class — no `@Injectable()`, no NestJS decorators. The Nest wrapper in apps/indexer (F1c) registers it via a `useFactory` provider: `{ provide: ArchiveWriter, useFactory: () => new ArchiveWriter({ pgDb, chDb, logger }) }`. This keeps `libs/sources/compound` framework-agnostic, matches the other 5 libs in the workspace, and lets Epic I's backfill driver consume the writer without pulling in `@nestjs/common`. The lib's specs run on Vitest (consistent with the lib's existing `vitest.config.mts`).

### Writer API

```ts
export interface ArchiveWriterDeps {
  pgDb: Kysely<PgDatabase>; // imported from @libs/db
  chDb: Kysely<ClickHouseDatabase>; // imported from @libs/db
  logger: Logger;
  /** Wall-clock factory. Used for PG `received_at`, DLQ `first_seen_at`, and DLQ `last_attempt_at`.
   *  CH `received_at` is server-stamped via `DEFAULT now()` (D-F1f-3) — not driven by this clock.
   *  Injectable for tests. Default `() => new Date()`. */
  now?: () => Date;
  /** Backoff sequence in ms. Default [200, 600, 1800]. Injectable for tests
   *  (which override to [0, 0, 0] to keep specs sub-millisecond). */
  retryBackoffMs?: readonly number[];
}

export interface ArchiveWriteContext {
  daoSourceId: string;
  sourceType: 'compound_governor';
  chainId: number;
  /** Source-package label for metric increments — `compound_governor` for F1. */
  sourceLabel: string;
}

export type ArchiveWriteOutcome =
  | { result: 'inserted' } // CH inserted + PG inserted (happy path)
  | { result: 'skipped_existing' } // step 1 found an existing row, no writes performed
  | { result: 'skipped_conflict' } // step 3 hit ON CONFLICT (concurrent writer beat us; idempotent)
  | { result: 'pg_dlq_routed' } // step 4 — PG insert retries exhausted → DLQ stage='archive_confirmation_write'
  | { result: 'pg_unreachable' }; // step 5 — DLQ itself unreachable; counter incremented; caller continues
// CH-insert failures (step 2) are NOT in the outcome union — they propagate as exceptions
// to the listener, which catches them per-event. See ADR-041 rider 2026-05-12.

export class ArchiveWriter {
  constructor(deps: ArchiveWriterDeps);
  write(
    ctx: ArchiveWriteContext,
    decoded: CompoundGovernorEvent,
    logRef: LogEvent,
  ): Promise<ArchiveWriteOutcome>;
}
```

The return value is structured rather than throwing — F1c's listener wraps `write` in `Promise.allSettled` against `EventPoller`'s batch, and the structured outcome drives metric increments and log levels. Throwing is reserved for programmer errors (assertion failures, type-level invariants the runtime can't reach).

### Step-by-step write protocol

#### Step 1 — PG existence check

```ts
const existing = await pgDb
  .selectFrom('archive_confirmation')
  .select(['id', 'confirmation_status'])
  .where('source_type', '=', ctx.sourceType)
  .where('chain_id', '=', ctx.chainId)
  .where('tx_hash', '=', logRef.txHash)
  .where('log_index', '=', logRef.logIndex)
  .where('block_hash', '=', logRef.blockHash)
  .executeTakeFirst();

if (existing) {
  getArchiveSkippedExistenceTotal().inc({ source: ctx.sourceLabel });
  logger.debug('archive_check_skip', { ...logRef, existing_id: existing.id });
  return { result: 'skipped_existing' };
}
```

The `WHERE` uses the 5-tuple unique index (`archive_confirmation_idempotency_key`) — index-only scan, single B-tree probe.

**Why include `confirmation_status` in the SELECT** even though we don't branch on it in M1: forward-compat with the M2 reconciliation job, which uses the same probe but may distinguish `pending`/`confirmed`/`orphaned` for orphan-sweep semantics. Cost: one extra column in an index-only scan — negligible.

**ADR-041 nuance:** ADR-041 step 1 only treats `pending` / `confirmed` rows as "already persisted." A row whose status is `orphaned` represents a prior reorg-orphaned write at the same 5-tuple; the partial unique index `idx_archive_confirmation_canonical` (over `WHERE confirmation_status <> 'orphaned'`) admits a fresh canonical row on top. F1 reads ADR-041 strictly: only `pending` / `confirmed` rows short-circuit step 1. The 5-tuple full-unique constraint forbids two `pending` rows with the same 5-tuple anyway, so the `orphaned` case is exotic but handled correctly by letting step 3's `ON CONFLICT DO NOTHING` absorb it. **Implementation:** the existence check above filters on the 5-tuple alone (matching the unique index exactly); the rare orphaned-clash case falls through to step 3, and the `archive_confirmation_idempotency_key UNIQUE` constraint absorbs it via `ON CONFLICT DO NOTHING` — outcome `skipped_conflict`. No special-case code; the schema does the work.

#### Step 2 — CH insert

```ts
const pgReceivedAt = now(); // used for PG/DLQ rows only; CH stamps its own
await chDb
  .insertInto('event_archive_compound_governor')
  .values({
    dao_source_id: ctx.daoSourceId,
    chain_id: ctx.chainId,
    block_number: logRef.blockNumber.toString(), // bigint → string (CH UInt64)
    block_hash: logRef.blockHash,
    tx_hash: logRef.txHash,
    log_index: logRef.logIndex,
    event_type: decoded.type,
    // received_at deliberately omitted — column declares `DEFAULT now()` (D-F1f-3)
    payload: JSON.stringify(decoded.payload),
  })
  .execute();
```

ReplacingMergeTree(received_at) absorbs duplicates eventually. A re-insert during the merge window produces two physical rows that dedupe on read (G1 issues `SELECT … FINAL`). ADR-041 documents `OPTIMIZE TABLE … FINAL` as off-limits to application code; F1 obeys.

**`received_at` provenance.** Per ADR-041 rider 2026-05-11 §3 and D-F1f-3, the CH column is `DateTime DEFAULT now()` (second precision). The writer does NOT supply `received_at`; CH stamps it on receipt. This reduces client-clock-skew exposure under future multi-replica deployments but does not eliminate it (each replica's `now()` evaluates locally). Second-precision means two re-observations of the same event within the same wall-clock second produce identical version values; the ReplacingMergeTree choice between them is non-deterministic. Compound's volume (~100-200 events/yr) makes this collision rare, and the chosen row is still a valid observation of the same canonical event — so the failure mode is benign at M1 scale. The PG `received_at` continues to be a JS-side `new Date()` (the `pgReceivedAt` local above), used for `archive_confirmation.received_at` and DLQ `first_seen_at`. The sub-second–to–seconds gap between CH and PG timestamps for the same logical event is accepted.

**CH errors propagate to the listener.** The writer does NOT catch CH errors. ADR-041 rider 2026-05-12 retracted the original rider §2 (`archive_ch_write` DLQ stage) — that path created stale-tombstone DLQ rows when CH recovered on the next tick. Instead, the listener (F1c) wraps each `archiveWriter.write()` call in its own try/catch: a CH glitch raises out of step 2, the listener increments `kvorum_archive_ch_write_errors_total{source}` and continues the batch, and the next 12-s tick re-runs step 1 → finds no PG row → re-attempts CH insert (ReplacingMergeTree absorbs the duplicate if both eventually succeed).

#### Step 3 — PG insert with retry

```ts
const row: NewArchiveConfirmation = {
  source_type: ctx.sourceType,
  dao_source_id: ctx.daoSourceId,
  chain_id: ctx.chainId,
  block_number: logRef.blockNumber.toString(),
  block_hash: logRef.blockHash,
  tx_hash: logRef.txHash,
  log_index: logRef.logIndex,
  event_type: decoded.type,
  received_at: pgReceivedAt,
  confirmation_status: 'pending',
  confirmed_at: null,
  orphaned_at: null,
  orphaned_by_reorg_event_id: null,
  derived_at: null,
};

for (let attempt = 0; attempt <= retryBackoffMs.length; attempt++) {
  try {
    const result = await pgDb
      .insertInto('archive_confirmation')
      .values(row)
      .onConflict((oc) => oc.constraint('archive_confirmation_idempotency_key').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (result?.id) {
      getArchiveWritesTotal().inc({ source: ctx.sourceLabel, result: 'inserted' });
      logger.info('pg_inserted', { ...logRef, archive_id: result.id });
      return { result: 'inserted' };
    } else {
      // ON CONFLICT fired — another writer beat us; idempotent
      getArchiveWritesTotal().inc({ source: ctx.sourceLabel, result: 'skipped_conflict' });
      logger.debug('pg_conflict_skip', logRef);
      return { result: 'skipped_conflict' };
    }
  } catch (err) {
    // Per ADR-041 rider 2026-05-11 §1: non-transient errors fail fast (no retry).
    const transient = isTransientPgError(err);
    if (transient && attempt < retryBackoffMs.length) {
      logger.warn('pg_insert_retry', { attempt, error: String(err) });
      await sleep(retryBackoffMs[attempt]);
      continue;
    }
    // Non-transient (first failure) or retries exhausted → step 4
    return await routePgFailureToDlq(err, ctx, logRef, pgReceivedAt);
  }
}
```

**Why `.returning('id').executeTakeFirst()` instead of `.execute()` + counting affected rows**: Kysely `executeTakeFirst()` returns `undefined` when no row is inserted (ON CONFLICT case) and `{ id }` when a row is inserted. Cleaner than reading `result.numAffectedRows`.

**ADR-041 retry budget:** 3 attempts × backoff `[200, 600, 1800]` ms. Total worst-case wall time for retries: 2.6 s. Plus the initial attempt and CH insert before retry. Worst-case write time on degraded PG: ~3 s. Well under EventPoller's 12-s tick interval.

**Transient-vs-permanent classification (ADR-041 rider 2026-05-11 §1).** `isTransientPgError(err)` lives next to the writer. The transient allowlist:

- Connection-level: `08000`, `08001`, `08003`, `08006`, `08007`
- Admin/shutdown: `57P01`, `57P02`, `57P03`
- Serialization: `40001`, `40P01`

Anything else (FK/CHECK `23xxx`, syntax `42xxx`, unmapped) routes to DLQ on the **first** failure — retrying a deterministic logic error wastes I/O and obscures the real failure mode in metrics.

#### Step 4 — DLQ on persistent failure

One DLQ helper for the PG-write failure surface. CH errors are handled by the listener (F1c), not here. Raw-only payload per ADR-041 rider 2026-05-11 §4.

```ts
async function routePgFailureToDlq(
  err: unknown,
  ctx: ArchiveWriteContext,
  logRef: LogEvent,
  pgReceivedAt: Date,
): Promise<ArchiveWriteOutcome> {
  const dlqRow: NewIngestionDlq = {
    stage: 'archive_confirmation_write',
    source: ctx.sourceLabel,
    payload: {
      raw: { topics: logRef.topics, data: logRef.data },
      block_number: logRef.blockNumber.toString(),
    },
    error: serializeError(err), // { name, message, stack, code }
    retries: retryBackoffMs.length, // 3
    first_seen_at: pgReceivedAt,
    last_attempt_at: now(),
    archive_source_type: ctx.sourceType,
    archive_chain_id: ctx.chainId,
    archive_tx_hash: logRef.txHash,
    archive_log_index: logRef.logIndex,
    archive_block_hash: logRef.blockHash,
  };
  try {
    await pgDb.insertInto('ingestion_dlq').values(dlqRow).execute();
    getArchiveWritesTotal().inc({ source: ctx.sourceLabel, result: 'pg_dlq_routed' });
    logger.error('pg_dlq_routed', { ...logRef, error: String(err) });
    return { result: 'pg_dlq_routed' };
  } catch (dlqErr) {
    // Step 5 — DLQ itself is unreachable
    getDualWritePgUnreachableTotal().inc({ source: ctx.sourceLabel });
    logger.error('dlq_insert_failed', { originalError: String(err), dlqError: String(dlqErr) });
    return { result: 'pg_unreachable' };
  }
}
```

**Raw-only DLQ payload (ADR-041 rider 2026-05-11 §4).** DLQ rows carry only `{ raw: { topics, data }, block_number }` plus the typed 5-tuple columns. Rationale:

- **Smallest rows.** Raw is ~200 B; decoded `ProposalCreated` payloads can reach ~50 KB for long markdown descriptions.
- **Chain as single source of truth.** The raw log is what the contract actually emitted; storing decoded fields risks drift if the decoder is later fixed.
- **Re-decode on retry exercises the decoder.** `dlq retry` (Epic I) re-runs `decodeCompoundLog` on the stored raw log — if the original DLQ was a decode failure and the decoder has since been fixed, the retry naturally validates the fix.
- **Operator forensics deferred to `admin-cli dlq inspect <id>`** (Epic I), which lazily decodes for human-readable display.

The `reason` field on the decode-error path (see "Decode-error path" below) carries the failure type (`unknown_topic` / `parse_failed` / `wrong_address`) so operators don't have to re-run the decoder just to learn why it failed.

#### Step 5 — DLQ unreachable

The `pg_unreachable` outcome bubbles up to F1c's listener. **F1c continues the batch** on `pg_unreachable` (each event independently retries on the next tick via step 1) — aborting was the original design but produced no measurable benefit: subsequent events in the same batch may hit a different code path (e.g. existence-check skip) and the counter is rate-limited by event volume anyway. The next 12-s tick re-fetches the window and retries from step 1.

**Unbounded-until-recovery loop (M1 accepted; M2 closes).** If step 3 routed to DLQ with a permanent error AND step 4 found PG unreachable for the DLQ insert too, the next tick's existence check finds nothing in PG, re-attempts CH insert (ReplacingMergeTree absorbs the duplicate eventually), then re-attempts step 3 with the same permanent error and the same DLQ-unreachable condition. **This loop is unbounded in F1.** It only terminates when (a) PG recovers and the DLQ insert succeeds, (b) the underlying permanent error is fixed (data state, FK target, etc.), or (c) the operator intervenes. F1 does not add a per-event circuit-breaker; tracking that would require either an in-memory LRU (loses state on restart) or a schema column (overkill for M1). `kvorum_dual_write_pg_unreachable_total{source}` increments on every iteration, so operators have a monotonic signal to alert on. The CH writer-side amplification is bounded by ClickHouse's server-side `async_insert` buffer (`async_insert=1, wait_for_async_insert=1` is set in `libs/db/src/client.ts`); ReplacingMergeTree dedupes duplicates at merge time. M1 accepts this window per ADR-041 §Reconciliation; M2's reconciliation job closes it by sweeping CH-orphans into a proper DLQ entry.

### Decode-error path

`decodeCompoundLog` throws `DecodeError` — F1c's listener catches and routes to DLQ with `stage='archive_decode'`. The typed archive-tuple columns (chain_id, tx_hash, log_index, block_hash, source_type) are populated from the raw `LogEvent`. `payload` carries `{ raw: { topics, data }, reason }` — the same raw-only shape as the PG DLQ path (ADR-041 rider 2026-05-11 §4). `reason` is one of `unknown_topic` / `parse_failed` / `wrong_address`. The listener increments a dedicated `kvorum_archive_decode_errors_total{source,reason}` counter — decode failures are tracked separately from the write-outcome label so the `archive_writes_total` enum stays clean (D-F1d-4).

This is a deliberate divergence from "log+drop." Decode failures on filtered logs (topic0 matches one of the four event topic hashes) are not expected; if they happen they indicate a contract upgrade or an RPC-level bug worth surfacing as a DLQ entry rather than a silent drop in production logs. The volume is expected to be zero under normal operation.

### Tests (`archive-writer.spec.ts`)

Test-only sentinels: `retryBackoffMs: [0, 0, 0]` for sub-millisecond test runs. Mocked `pgDb` / `chDb` via Vitest mocks; no real DB. The full DB-touching exercise lands in the F1c integration spec.

| #   | What it asserts                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Happy path: existence check empty → CH insert called once (no `received_at` field) → PG insert returns `{ id }` → outcome `'inserted'`, counter increments                                                                                                                                                                                       |
| 2   | Existence-skip: existence check returns row → CH + PG insert NOT called, counter `skipped_existence` increments, outcome `'skipped_existing'`                                                                                                                                                                                                    |
| 3   | PG conflict (concurrent writer): existence check empty → CH insert called → PG insert returns `undefined` → outcome `'skipped_conflict'`, counter increments                                                                                                                                                                                     |
| 4   | PG transient error (08006) retried 3 times then succeeds → outcome `'inserted'`, retry counter logged at each attempt                                                                                                                                                                                                                            |
| 5   | PG transient error exhausts retries → DLQ insert called with stage `'archive_confirmation_write'`, typed columns populated, outcome `'pg_dlq_routed'`                                                                                                                                                                                            |
| 6   | PG non-transient error (FK violation `23503`) fails fast (no retry) → DLQ insert, outcome `'pg_dlq_routed'`                                                                                                                                                                                                                                      |
| 7   | DLQ insert itself fails (after PG path) → counter `pg_unreachable` increments, outcome `'pg_unreachable'`                                                                                                                                                                                                                                        |
| 8   | CH insert failure → exception propagates out of `.write()` (writer does NOT catch); PG insert + DLQ insert NOT attempted. Listener-level catch is tested in `ingester-listener.spec.ts`                                                                                                                                                          |
| 9   | uint256 boundary value in payload: round-trip via `JSON.stringify` preserves the decimal string                                                                                                                                                                                                                                                  |
| 10  | Address normalisation: input event has lowercased address (poller invariant); writer doesn't re-normalise (asserted via mock spy)                                                                                                                                                                                                                |
| 11  | CH insert call does NOT include `received_at` (server-stamped per D-F1f-3); DLQ `first_seen_at` was captured before the CH insert (i.e. `first_seen_at ≤ last_attempt_at`)                                                                                                                                                                       |
| 12  | DLQ row's `payload` is raw-only: `{ raw: { topics, data }, block_number }` — no `event_type` / decoded fields                                                                                                                                                                                                                                    |
| 13  | DLQ row's `error` is shaped `{ name, message, code, stack }` — not a raw string                                                                                                                                                                                                                                                                  |
| 14  | Retry exhaustion logs at warn for each attempt and error on final failure (assert via captured logger)                                                                                                                                                                                                                                           |
| 15  | Concurrent writes for the same 5-tuple (two parallel `.write()` calls): exactly one returns `'inserted'`, the other `'skipped_conflict'`                                                                                                                                                                                                         |
| 16  | `isTransientPgError` classifier — table-driven test asserts: (a) SQLSTATE allowlist `08xxx`, `57P0x`, `40001`, `40P01`, `53300`, `08004` → true; (b) Node-level codes `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND` (read from `err.code` per node-pg `DatabaseError` shape) → true; (c) `23503`, `42703`, unknown SQLSTATE, plain string error → false |

### Decisions captured (F1b)

| #        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-F1b-1  | Write protocol per ADR-041 + 2026-05-11 rider §1/§3/§4 + 2026-05-12 retraction of §2: PG check (5-tuple, status-agnostic) → CH insert (errors propagate to listener) → PG insert with transient-error retry → DLQ on permanent or exhausted → PG-unreachable counter on DLQ-insert fail                                                                                                                                           |
| D-F1b-2  | Retry budget 3 × `[200, 600, 1800]` ms per ADR-041. Applies only to transient PG errors. Total worst-case ~3 s — well under 12-s tick interval                                                                                                                                                                                                                                                                                    |
| D-F1b-3  | Transient-vs-permanent PG error classification per ADR-041 rider 2026-05-11 §1, with two extensions: (a) SQLSTATE allowlist adds `53300` (too_many_connections) and `08004` (server_rejected_establishment); (b) Node-level codes `ECONNRESET`/`ETIMEDOUT`/`ENOTFOUND` read from `err.code` (node-pg `DatabaseError`). Everything else → DLQ on first failure                                                                     |
| D-F1b-4  | Existence-check probe uses the 5-tuple unique constraint exactly (no `confirmation_status` filter). The `archive_confirmation_idempotency_key UNIQUE` is **status-agnostic** — a row at a given 5-tuple occupies the slot regardless of `confirmation_status`. Re-canonicalization at the _same_ `block_hash` is impossible under chain physics (same hash = same block), so the "orphan-clash" case is a no-op rather than a bug |
| D-F1b-5  | CH `received_at` is server-stamped via `DEFAULT now()` (D-F1f-3 / ADR-041 rider §3); writer does NOT supply it. Second precision is accepted at M1 scale (Compound's ~100-200 events/yr makes intra-second collisions negligible)                                                                                                                                                                                                 |
| D-F1b-6  | Decode error → DLQ with `stage='archive_decode'`, not log+drop. Volume expected zero; surfaces contract upgrades/RPC bugs. Counted on dedicated `kvorum_archive_decode_errors_total{source,reason}` (not on `archive_writes_total{result}`)                                                                                                                                                                                       |
| D-F1b-7  | DLQ `payload` is raw-only `{ raw: { topics, data }, block_number, reason? }` (ADR-041 rider §4). Decode on retry; operator inspection via `admin-cli dlq inspect` (Epic I)                                                                                                                                                                                                                                                        |
| D-F1b-8  | DLQ insert failure (`pg_unreachable`) bubbles to F1c's listener but does NOT abort the batch — each event independently retries on the next tick. **The retry loop is unbounded in F1** when the underlying PG error is permanent AND PG is unreachable for DLQ; M2 reconciliation closes the window. Operators alert on `kvorum_dual_write_pg_unreachable_total`                                                                 |
| D-F1b-9  | Outcome is a structured tagged union, not a throw, for PG-side outcomes. CH-insert exceptions are the one exception: they propagate (caught by the listener). Throws reserved for CH failures + programmer errors                                                                                                                                                                                                                 |
| D-F1b-10 | **(retracted 2026-05-12)** Originally: route CH-insert errors to DLQ with `stage='archive_ch_write'`. Retracted because the next-tick retry produces stale DLQ tombstones when CH recovers. Replaced by: CH errors propagate to listener, which catches per-event and continues the batch. See ADR-041 rider 2026-05-12                                                                                                           |

---

## F1c — apps/indexer NestJS wrapper: dao_source bootstrap + per-source EventPoller lifecycle

### Scope

The apps/indexer-side wrapper that consumes the framework-agnostic primitives from `@libs/sources-compound/governor` (F1a, F1b) and wires them into the NestJS DI graph. Specifically:

1. On `OnApplicationBootstrap`, queries `dao_source WHERE source_type='compound_governor'`
2. For each row, creates a per-chain `FailoverRpcClient` (shared across rows on the same chain) and one `EventPoller` filtered to `(governor_address, [ProposalCreated, ProposalQueued, ProposalExecuted, ProposalCanceled])`
3. Wires the EventPoller's `onEvents` listener to a per-source `ArchiveWriter` (both imported from the lib; `makeIngesterListener` is the listener factory; `ArchiveWriter` is instantiated via `useFactory` provider)
4. Starts pollers
5. On `OnApplicationShutdown`, stops all pollers (await drain) and stops RPC clients

Also covers `pgDb.destroy()` via a separate `DatabaseLifecycleService` so the wiring is shared across future source modules (Aave/Lido land in M3/M4).

The Nest module file is intentionally thin — it is the composition root that turns lib primitives into Nest providers. No business logic lives here.

### Module layout

```
apps/indexer/src/
  app/
    app.module.ts                          — updated: imports IndexerModule, DatabaseLifecycleModule
    database-lifecycle.service.ts          — calls pgDb.destroy() on shutdown
    database-lifecycle.module.ts
  indexer/
    indexer.module.ts                      — re-exports source modules
  sources/
    compound-governor/
      compound-governor.module.ts          — Nest module: providers wire ArchiveWriter (useFactory) + listener factory + service
      compound-governor.service.ts         — @Injectable bootstrap + lifecycle orchestration (Nest-specific)
      compound-governor.service.spec.ts    — Jest tests: DI + bootstrap + Drainable + shutdown order + partial-bootstrap cleanup
```

`archive-writer.ts`, `archive-writer.spec.ts`, `ingester-listener.ts`, `ingester-listener.spec.ts`, and the event types all live in `libs/sources/compound/src/governor/` (F1b). The apps/indexer wrapper imports them via `@libs/sources-compound`.

### Nest module wiring

```ts
import { ArchiveWriter, makeIngesterListener } from '@libs/sources-compound';
import { pgDb, chDb } from '@libs/db';

@Module({
  providers: [
    {
      provide: ArchiveWriter,
      useFactory: () => new ArchiveWriter({ pgDb, chDb, logger: new Logger('ArchiveWriter') }),
    },
    CompoundGovernorService,
  ],
  exports: [CompoundGovernorService],
})
export class CompoundGovernorModule {}
```

The factory provider is the seam between framework-agnostic lib and Nest DI. Adding Aave/Lido in M3/M4 follows the same pattern (one factory provider per source-writer, one bootstrap service per Nest module).

### Bootstrap flow

```ts
import { ArchiveWriter, makeIngesterListener, COMPOUND_EVENT_TOPICS } from '@libs/sources-compound';

@Injectable()
export class CompoundGovernorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CompoundGovernor');
  private readonly pollers: EventPoller[] = [];
  private readonly clients: FailoverRpcClient[] = [];

  constructor(
    private readonly archiveWriter: ArchiveWriter, // injected via useFactory in CompoundGovernorModule
    private readonly drainables: DrainableRegistry, // registers self for ordered shutdown
  ) {
    this.drainables.register(this);
  }

  async onApplicationBootstrap(): Promise<void> {
    // 1. Parse chain config from env
    const chains = parseChainConfigFromEnv(process.env);
    const chainsByChainId = new Map(chains.map((c) => [c.chainId, c]));

    // 2. Load dao_source rows
    const sources = await pgDb
      .selectFrom('dao_source')
      .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_config',
        'dao.primary_chain_id',
      ])
      .where('dao_source.source_type', '=', 'compound_governor')
      .execute();

    if (sources.length === 0) {
      this.logger.warn('No compound_governor dao_source rows; indexer will idle');
      return;
    }

    // 3. Pre-validate ALL source_configs + chain mappings BEFORE starting any RPC client.
    //    Avoids burning RPC quota on N-1 clients if source N has a misconfigured payload.
    //    Per D-F1c-13 / OQ-F1-15.
    const validated: Array<{
      src: (typeof sources)[number];
      cfg: DaoSourceConfig;
      chainCfg: ChainConfig;
    }> = [];
    for (const src of sources) {
      const cfg = parseDaoSourceConfig(src.source_config); // zod; throws on malformed
      const chainCfg = chainsByChainId.get(src.primary_chain_id);
      if (!chainCfg) {
        throw new Error(
          `compound_governor dao_source on chain ${src.primary_chain_id} but CHAIN_CONFIG has no entry`,
        );
      }
      validated.push({ src, cfg, chainCfg });
    }

    // 4. Create per-chain RPC clients (shared across sources on the same chain).
    //    On any client.start() failure, stop already-started clients before re-throwing —
    //    otherwise Nest's bootstrap-error unwind leaks them (D-F1c-14).
    const clientsByChainId = new Map<number, FailoverRpcClient>();
    try {
      for (const { src, chainCfg } of validated) {
        if (clientsByChainId.has(src.primary_chain_id)) continue;
        const client = new FailoverRpcClient(chainCfg);
        await client.start();
        clientsByChainId.set(src.primary_chain_id, client);
        this.clients.push(client);
      }

      // 5. Per source: build filter, create EventPoller, attach listener, start.
      //    Same cleanup discipline — a poller.start() failure stops everything before re-throwing.
      for (const { src, cfg, chainCfg } of validated) {
        const client = clientsByChainId.get(src.primary_chain_id)!;

        const poller = new EventPoller({
          rpcClient: client,
          chainId: src.primary_chain_id,
          chainName: chainCfg.name,
          reorgHorizon: chainCfg.reorgHorizon,
          sourceType: 'compound_governor',
          daoSourceLabel: src.id, // UUID
          filter: {
            address: cfg.governor_address.toLowerCase(),
            topics: [Object.values(COMPOUND_EVENT_TOPICS)], // OR-match at position 0
          },
          pollIntervalMs: 12_000,
          logger: this.logger,
        });

        const listener = makeIngesterListener({
          archiveWriter: this.archiveWriter,
          context: {
            daoSourceId: src.id,
            sourceType: 'compound_governor',
            chainId: src.primary_chain_id,
            sourceLabel: 'compound_governor',
          },
          logger: this.logger,
        });

        poller.onEvents(listener);
        await poller.start();
        this.pollers.push(poller);
      }
    } catch (err) {
      this.logger.error('bootstrap_failed_cleanup', { error: String(err) });
      // Stop already-started pollers + clients, ignore individual failures during teardown
      await Promise.allSettled(this.pollers.map((p) => p.stop()));
      await Promise.allSettled(this.clients.map((c) => c.stop()));
      this.pollers.length = 0;
      this.clients.length = 0;
      throw err; // Nest fails bootstrap; process exits cleanly
    }

    getIndexerActiveSources().set({ source_type: 'compound_governor' }, sources.length);
    this.logger.log(
      `compound_governor: ${sources.length} source(s) live across ${clientsByChainId.size} chain(s)`,
    );
  }

  /** Called by DatabaseLifecycleService via DrainableRegistry; awaited BEFORE pgDb.destroy(). */
  async drain(): Promise<void> {
    // Stop pollers first (drains in-flight ticks) — pollers may still touch pgDb/chDb mid-tick
    await Promise.allSettled(this.pollers.map((p) => p.stop()));
    // Then stop clients
    await Promise.allSettled(this.clients.map((c) => c.stop()));
  }

  /** Nest's OnApplicationShutdown hook is a no-op here — drain ordering is owned by DatabaseLifecycleService. */
  async onApplicationShutdown(): Promise<void> {
    // intentionally empty; see DrainableRegistry
  }
}
```

### DrainableRegistry + DatabaseLifecycleService — ordered shutdown

NestJS does not guarantee `OnApplicationShutdown` order across sibling providers. F1 introduces a small `DrainableRegistry` so the `pgDb`/`chDb` teardown can wait for all source modules (and future M3/M4 Aave/Lido) to drain their in-flight DB work before the connection pools close.

```ts
// libs/utils/src/lifecycle/drainable-registry.ts  (or apps/indexer/src/app/)
export interface Drainable {
  drain(): Promise<void>;
}

@Injectable()
export class DrainableRegistry {
  private readonly members: Drainable[] = [];
  register(d: Drainable): void {
    this.members.push(d);
  }
  async drainAll(): Promise<void> {
    await Promise.allSettled(this.members.map((d) => d.drain()));
  }
}

// apps/indexer/src/app/database-lifecycle.service.ts
@Injectable()
export class DatabaseLifecycleService implements OnApplicationShutdown {
  constructor(private readonly drainables: DrainableRegistry) {}
  async onApplicationShutdown(): Promise<void> {
    await this.drainables.drainAll(); // pollers stop, clients stop, in-flight DB work flushes
    await pgDb.destroy(); // then close the pool
  }
}
```

`DrainableRegistry` is a singleton in `IndexerModule`. Source services register themselves at construction. Adding a new source module (Aave in M3) only requires the constructor to inject `DrainableRegistry` and call `.register(this)`. The plain `Drainable` interface keeps the contract narrow — no NestJS lifecycle leakage into the registry.

### `dao_source.source_config` parsing

The seed JSON is `{"governor_address": "0xc0Da02939E1441F497fd74F78cE7Decb17B66529"}`. Parsed via zod for safety:

```ts
const DaoSourceConfigSchema = z.object({
  governor_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
type DaoSourceConfig = z.infer<typeof DaoSourceConfigSchema>;
```

A malformed `source_config` is a fatal-bootstrap error (operator misconfiguration), not a DLQ candidate. Surface with a descriptive message and refuse to start.

### Ingester listener

```ts
export function makeIngesterListener(deps: {
  archiveWriter: ArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
}): EventsListener {
  return async (events: LogEvent[]) => {
    const endTimer = getBatchDurationSeconds().startTimer({ source: deps.context.sourceLabel });
    try {
      for (const log of events) {
        let decoded: CompoundGovernorEvent;
        try {
          decoded = decodeCompoundLog(log);
        } catch (err) {
          // DecodeError → DLQ with stage='archive_decode'; dedicated counter, not on archive_writes_total
          await routeDecodeErrorToDlq(deps, log, err);
          getArchiveDecodeErrorsTotal().inc({
            source: deps.context.sourceLabel,
            reason: (err as DecodeError).reason ?? 'unknown',
          });
          continue;
        }

        try {
          // Outcomes 'inserted' | 'skipped_existing' | 'skipped_conflict' | 'pg_dlq_routed' |
          // 'pg_unreachable' — all non-throwing. Batch continues for every outcome;
          // pg_unreachable is rate-limited by the event volume itself and the next tick
          // retries from step 1 (D-F1b-8).
          await deps.archiveWriter.write(deps.context, decoded, log);
        } catch (err) {
          // CH-insert failures propagate as exceptions (ADR-041 rider 2026-05-12 retracted §2's
          // CH-DLQ path). Per-event catch ensures one CH glitch doesn't drop the rest of the
          // batch — the next tick re-runs step 1, finds no PG row, retries CH (idempotent
          // via ReplacingMergeTree). Log + count; the batch continues.
          getArchiveChWriteErrorsTotal().inc({ source: deps.context.sourceLabel });
          deps.logger.error('ch_write_error', {
            ...log,
            error: String(err),
          });
        }
      }
    } finally {
      endTimer();
    }
  };
}
```

The sequential `for` loop (not `Promise.all`) is intentional:

- ADR-041's PG-first existence check is sequential by nature (the check informs whether to write).
- A burst of N events from a single `eth_getLogs` page is rare under steady-state polling (mainnet block produces ~0–3 governance events per block).
- Sequential processing simplifies metric attribution and log ordering.

If empirical observation under backfill (Epic I) shows sequential is too slow, batched-with-Promise.all is a small refactor — but the existence check is already idempotent under concurrent racing, so batching is safe correctness-wise.

**Batch duration histogram.** The listener wraps each batch in `kvorum_ingestion_batch_duration_seconds{source}` (F1d). Operators can alert on p95 approaching the 12-s tick budget — sustained breaches indicate the next-tick overlap window is widening (per OQ-F1-14).

### Tests (`compound-governor.service.spec.ts` + `ingester-listener.spec.ts`)

#### Service-level (DI + lifecycle)

| #   | What it asserts                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bootstrap with 0 dao_source rows: no pollers started, no clients started; warn logged; `kvorum_indexer_active_sources{source_type='compound_governor'}` = 0                                                     |
| 2   | Bootstrap with 1 dao_source row: 1 client started, 1 poller started, filter shape matches `(governor_address, [4 topic0s])`; `kvorum_indexer_active_sources` = 1                                                |
| 3   | Bootstrap with 2 dao_source rows on the same chain: 1 client (shared), 2 pollers                                                                                                                                |
| 4   | Bootstrap with 2 dao_source rows on different chains: 2 clients, 2 pollers                                                                                                                                      |
| 5   | Malformed `source_config` on source N (N>1): pre-validation throws BEFORE any `FailoverRpcClient.start()` is called (assert via spy)                                                                            |
| 6   | dao_source on a chain not in `CHAIN_CONFIG`: pre-validation throws with descriptive error, no client started                                                                                                    |
| 7   | DrainableRegistry: service registers itself in constructor; `drainAll()` invokes `drain()` once                                                                                                                 |
| 8   | Drain: all pollers stopped before clients (assert call order via spy); poller `.stop()` failure does not block others (Promise.allSettled)                                                                      |
| 9   | DatabaseLifecycleService.onApplicationShutdown: `drainAll()` resolves before `pgDb.destroy()` is called (assert via spy ordering)                                                                               |
| 10  | Partial-bootstrap failure: chains [A, B] both pass pre-validation, client A starts, client B's `.start()` rejects → catch path stops client A, leaves `this.clients` empty, re-throws original error (D-F1c-14) |

#### Listener-level (decode + write)

| #   | What it asserts                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Single event in batch → archiveWriter.write called once with correct context                                                                                                                                |
| 2   | Multiple events in batch → archiveWriter.write called sequentially in order                                                                                                                                 |
| 3   | Decode failure → DLQ insert called with `stage='archive_decode'` and payload `{ raw: { topics, data }, reason }`; `kvorum_archive_decode_errors_total{source,reason}` increments by reason; batch continues |
| 4   | Write returns `'pg_unreachable'` → batch CONTINUES (subsequent events processed independently per D-F1b-8)                                                                                                  |
| 5   | Write throws (CH-insert failure) → listener catches per-event, `kvorum_archive_ch_write_errors_total{source}` increments, batch continues; next event's `archiveWriter.write()` is still called             |
| 6   | Write returns `'skipped_existing'` → no error, batch continues                                                                                                                                              |
| 7   | All four event types decode + dispatch (regression test for filter completeness)                                                                                                                            |
| 8   | Batch duration histogram observes one sample per batch (assert via mock registry)                                                                                                                           |

### Integration test (F1-anvil-1)

Added to `libs/chain/tests/anvil.integration.spec.ts` (no new file).

**Setup:** Deploy a minimal mock Governor contract on Anvil that emits `ProposalCreated(1, addr, [], [], [], [], 100, 200, "hello")`. Use the same `solc`-free creation-bytecode trick as E4-anvil-1 — a `CREATE` payload that constructs an empty-runtime contract whose constructor `LOG3`s the event (no runtime code needed because the test only triggers one constructor-emitted event).

Alternative if constructor-emit is unwieldy: deploy a real `GovernorBravoEvents` minimal contract via `forge create` from a CI fixture in `libs/chain/tests/fixtures/`. The fixture is one ~20-line .sol file. The bytecode-only path is preferred to keep the dependency surface flat (no solc).

**Flow:**

1. Start an Anvil-targeted `FailoverRpcClient`.
2. Insert a fixture `dao` + `dao_source` row pointing to the deployed mock address (PG-backed test DB; CI provides `DATABASE_URL`).
3. Insert the matching `source_type` row.
4. Boot a one-shot `EventPoller` + `ArchiveWriter` (no NestJS — wire up by hand to keep the test thin).
5. Trigger the event via a transaction.
6. Wait one poll interval (12 s — too long for CI; **override `pollIntervalMs` to 500 ms in the test**).
7. Assert:
   - `archive_confirmation` has one row with the 5-tuple, `confirmation_status='pending'`
   - `event_archive_compound_governor` has one row with the same 5-tuple, payload contains `proposalId: '1'` + `description: 'hello'`
   - `kvorum_ingestion_pending_event_count{chain_id="31337",source_type="compound_governor"}` is 1
   - `kvorum_ingestion_archive_writes_total{source="compound_governor",result="inserted"}` increments by 1

**Idempotency assertion (F1-anvil-2 — required, ~30 min):**

1. Replay the same event payload by issuing the same transaction a second time from a different nonce (the contract emits the same event topics/data; the log differs only by `tx_hash`/`log_index`/`block_hash`).
2. Assert two distinct `archive_confirmation` rows (different 5-tuples → distinct entries).
3. Assert two distinct CH rows.

Issue #29's acceptance criteria explicitly require "idempotency exercised: replay historical logs." The writer-spec mock-level race (#15) covers concurrent racing; F1-anvil-2 covers full replay through the live writer.

**Block-hash idempotency (F1-anvil-3 — required, ~30 min):**

1. Emit the event in block N.
2. Snapshot the resulting `archive_confirmation` row.
3. Use `anvil_reorg` to drop block N and re-mine a different block with the same tx but a different block_hash.
4. Assert two distinct `archive_confirmation` rows with same `(chain_id, tx_hash, log_index)` but different `block_hash` — this is the core SPEC §3.3 "include block_hash in idempotency key" invariant.

**Foundry version pinning.** `anvil_reorg` argument semantics have shifted across Foundry releases (depth-only vs tx-replay shape). E4-anvil-2 already pins Anvil's expected arg form; F1-anvil-3 inherits the same pin. The test asserts the request shape it sends matches the Foundry version installed in CI — if the precondition fails, the test logs the Foundry version and skips rather than producing a false-positive pass (same pattern as E4-anvil-2).

F3 covers the same invariant end-to-end through the reorg flow; F1-anvil-3 is the cheaper unit-level guard that catches the regression at the writer boundary before F3's heavier setup runs.

### Decisions captured (F1c)

| #        | Decision                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-F1c-1  | One `FailoverRpcClient` per chain (shared across sources on that chain). One `EventPoller` per `dao_source`. Sharing avoids redundant RPC quota burn                                                                                                                                                                                                                                                |
| D-F1c-2  | `chain_id` resolved via `dao.primary_chain_id` JOIN, not hardcoded. M1 is mainnet-only but the design is multi-chain ready                                                                                                                                                                                                                                                                          |
| D-F1c-3  | `dao_source.source_config` parsed via zod. Malformed config is a fatal-bootstrap error, not a DLQ candidate                                                                                                                                                                                                                                                                                         |
| D-F1c-4  | dao_source reload after process start is **not** supported in M1. Operator runs `pnpm -w db:migrate` + restart to pick up new sources. Live reconfig is an explicit M2/M3 feature                                                                                                                                                                                                                   |
| D-F1c-5  | Per-EventPoller filter is `(governor_address, [4 topic0s])` with OR-match at position 0. Single subscription per source captures all 4 event types                                                                                                                                                                                                                                                  |
| D-F1c-6  | Listener processes events sequentially within a batch (not `Promise.all`). PG-first check is inherently sequential; M1's event volume doesn't motivate parallelism                                                                                                                                                                                                                                  |
| D-F1c-7  | `pg_unreachable` outcome does NOT abort the batch — each event independently retries on the next tick (per D-F1b-8). Risk window documented in F1b §Step 5                                                                                                                                                                                                                                          |
| D-F1c-8  | Decode errors route to DLQ (`stage='archive_decode'`) rather than log+drop. Volume is expected to be zero in production; non-zero indicates a contract change worth surfacing                                                                                                                                                                                                                       |
| D-F1c-9  | `DrainableRegistry` + `DatabaseLifecycleService` pattern: source services register at construction; `DatabaseLifecycleService.onApplicationShutdown` calls `drainAll()` before `pgDb.destroy()`. Explicit ordering, scales to M3/M4 sources                                                                                                                                                         |
| D-F1c-10 | NestJS Logger used throughout (`new Logger('CompoundGovernor')`). Future M2 task swaps to structured logger; F1 stays consistent with E1/E2 precedent. KNOWN-001 already covers the rotation                                                                                                                                                                                                        |
| D-F1c-11 | F1 does **not** instantiate `HeadTracker` or `ReorgDetector`. Those belong to F2 (promotion sweep + reorg orphaning)                                                                                                                                                                                                                                                                                |
| D-F1c-12 | No generic `EVMEventIngester` abstraction in F1. Compound-specific listener + writer in `libs/sources/compound/src/governor/`; M3 (Aave) extracts shared primitives into `libs/sources/_common/` (or `libs/chain/ingester/`) once a second concrete exists                                                                                                                                          |
| D-F1c-16 | Source primitives live in `libs/sources/<source>/src/<contract-kind>/` as framework-agnostic plain classes; the apps/indexer Nest wrapper is a thin composition root that registers the lib's `ArchiveWriter` via `useFactory` and consumes `makeIngesterListener`. Keeps `libs/sources/*` framework-agnostic per CLAUDE.md module-boundaries; backfill driver (Epic I) reuses without pulling Nest |
| D-F1c-13 | Bootstrap pre-validates ALL `dao_source.source_config` rows and chain mappings BEFORE starting any `FailoverRpcClient` (OQ-F1-15). Avoids burning RPC quota on N-1 clients before throwing on source N                                                                                                                                                                                              |
| D-F1c-14 | Per-chain `client.start()` and per-source `poller.start()` are wrapped in a single bootstrap-wide try/catch. On any failure, already-started clients and pollers are stopped via `Promise.allSettled` before re-throwing — Nest's bootstrap-error unwind otherwise leaks them                                                                                                                       |
| D-F1c-15 | Listener wraps each `archiveWriter.write()` call in its own try/catch to absorb CH-insert failures (ADR-041 rider 2026-05-12 retracted §2's CH-DLQ path). CH errors increment `kvorum_archive_ch_write_errors_total{source}` and the batch continues; the next 12-s tick retries                                                                                                                    |

---

## F1d — Metrics

### New metrics

In `libs/chain/src/metrics/metrics.ts`, following the lazy `get<Name>()` convention:

```ts
let pendingEventCount: Gauge | null = null;
export function getPendingEventCount(): Gauge {
  if (!pendingEventCount) {
    pendingEventCount = new Gauge({
      name: 'kvorum_ingestion_pending_event_count',
      help: 'Count of archive_confirmation rows in pending state per chain × source_type. Updated by periodic recalculation, not per-write.',
      labelNames: ['chain_id', 'source_type'],
      registers: [registry],
    });
  }
  return pendingEventCount;
}

let archiveWritesTotal: Counter | null = null;
export function getArchiveWritesTotal(): Counter {
  if (!archiveWritesTotal) {
    archiveWritesTotal = new Counter({
      name: 'kvorum_ingestion_archive_writes_total',
      help: 'Archive write outcomes by source. result=inserted|skipped_existing|skipped_conflict|pg_dlq_routed. CH errors → kvorum_archive_ch_write_errors_total; decode errors → kvorum_archive_decode_errors_total; pg_unreachable → kvorum_dual_write_pg_unreachable_total.',
      labelNames: ['source', 'result'],
      registers: [registry],
    });
  }
  return archiveWritesTotal;
}

let archiveChWriteErrorsTotal: Counter | null = null;
export function getArchiveChWriteErrorsTotal(): Counter {
  if (!archiveChWriteErrorsTotal) {
    archiveChWriteErrorsTotal = new Counter({
      name: 'kvorum_archive_ch_write_errors_total',
      help: 'CH-insert failures per source. Listener catches per-event; batch continues. Next 12-s tick retries via step 1.',
      labelNames: ['source'],
      registers: [registry],
    });
  }
  return archiveChWriteErrorsTotal;
}

let archiveDecodeErrorsTotal: Counter | null = null;
export function getArchiveDecodeErrorsTotal(): Counter {
  if (!archiveDecodeErrorsTotal) {
    archiveDecodeErrorsTotal = new Counter({
      name: 'kvorum_archive_decode_errors_total',
      help: 'DecodeError occurrences per source. reason=unknown_topic|parse_failed|wrong_address.',
      labelNames: ['source', 'reason'],
      registers: [registry],
    });
  }
  return archiveDecodeErrorsTotal;
}

let indexerActiveSources: Gauge | null = null;
export function getIndexerActiveSources(): Gauge {
  if (!indexerActiveSources) {
    indexerActiveSources = new Gauge({
      name: 'kvorum_indexer_active_sources',
      help: 'Count of dao_source rows the indexer booted with per source_type. Zero is a deployable-but-actionable signal (misconfigured table).',
      labelNames: ['source_type'],
      registers: [registry],
    });
  }
  return indexerActiveSources;
}

let archiveSkippedExistenceTotal: Counter | null = null;
export function getArchiveSkippedExistenceTotal(): Counter {
  if (!archiveSkippedExistenceTotal) {
    archiveSkippedExistenceTotal = new Counter({
      name: 'kvorum_archive_skipped_existence_total',
      help: 'PG-first existence check hits (ADR-041 step 1). Increments when an event was already persisted.',
      labelNames: ['source'],
      registers: [registry],
    });
  }
  return archiveSkippedExistenceTotal;
}

let dualWritePgUnreachableTotal: Counter | null = null;
export function getDualWritePgUnreachableTotal(): Counter {
  if (!dualWritePgUnreachableTotal) {
    dualWritePgUnreachableTotal = new Counter({
      name: 'kvorum_dual_write_pg_unreachable_total',
      help: 'PG unreachable for the DLQ insert itself (ADR-041 step 5). Single source of truth for this failure mode.',
      labelNames: ['source'],
      registers: [registry],
    });
  }
  return dualWritePgUnreachableTotal;
}

let batchDurationSeconds: Histogram | null = null;
export function getBatchDurationSeconds(): Histogram {
  if (!batchDurationSeconds) {
    batchDurationSeconds = new Histogram({
      name: 'kvorum_ingestion_batch_duration_seconds',
      help: 'Wall-clock duration of one EventPoller batch through the ingester listener (decode + writer per event). One observation per batch.',
      labelNames: ['source'],
      // Buckets straddle the 12-s tick budget (OQ-F1-14) — operators alert on p95 ≥ 12 s.
      buckets: [0.1, 0.5, 1, 2, 4, 8, 12, 16, 30],
      registers: [registry],
    });
  }
  return batchDurationSeconds;
}
```

Append to `resetMetrics()`:

```ts
pendingEventCount = null;
archiveWritesTotal = null;
archiveChWriteErrorsTotal = null;
archiveDecodeErrorsTotal = null;
archiveSkippedExistenceTotal = null;
dualWritePgUnreachableTotal = null;
indexerActiveSources = null;
batchDurationSeconds = null;
```

### Pending-depth gauge updater

A small `PendingDepthGaugeService` injected into `CompoundGovernorModule`. Runs every 10 s via `setInterval` (NestJS `@Interval(10_000)` decorator from `@nestjs/schedule` if it's already a dep; otherwise plain `setInterval` with cleanup in `OnApplicationShutdown`). Query:

```ts
// JOIN on dao_source dropped — query uses no column from it.
const rows = await pgDb
  .selectFrom('archive_confirmation')
  .select(['chain_id', 'source_type', sql<number>`count(*)::int`.as('count')])
  .where('confirmation_status', '=', 'pending')
  .where('source_type', '=', 'compound_governor')
  .groupBy(['chain_id', 'source_type'])
  .execute();

for (const row of rows) {
  getPendingEventCount().set(
    { chain_id: String(row.chain_id), source_type: row.source_type },
    row.count,
  );
}
```

**Why a periodic count vs per-write increment**: per-write increment requires F2's promotion sweep to decrement, which couples F1's metric to F2's transaction. A periodic count is a self-contained primitive owned by F1 and survives F2 / F3 changes. Cost: one cheap aggregate query every 10 s on a table indexed on `(confirmation_status, block_number)`.

The 10-s cadence is faster than the alert evaluation window (Prometheus typically 15 s) but slower than the 12-s polling tick — staleness is bounded to ~10 s, well under the 4-min latency budget.

**Operational note: gauge grows monotonically until F2 ships.** F1 only writes `pending` rows; F2 introduces the promotion sweep that demotes `pending → confirmed` (or `→ orphaned`). Between F1 landing in `main` and F2 landing, the gauge climbs without bound. **No alert on `kvorum_ingestion_pending_event_count` until F2 is merged.** Operators monitor it as a trend signal, not an SLA. The H4 metrics inventory will note this dependency.

### Metric label conventions

| Metric                                    | Labels                             | Values                                                                            |
| ----------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `kvorum_ingestion_pending_event_count`    | `chain_id` (string), `source_type` | `"1"`, `"compound_governor"`                                                      |
| `kvorum_ingestion_archive_writes_total`   | `source`, `result`                 | `"compound_governor"`, `inserted/skipped_existing/skipped_conflict/pg_dlq_routed` |
| `kvorum_archive_skipped_existence_total`  | `source`                           | `"compound_governor"`                                                             |
| `kvorum_archive_ch_write_errors_total`    | `source`                           | `"compound_governor"`                                                             |
| `kvorum_archive_decode_errors_total`      | `source`, `reason`                 | `"compound_governor"`, `unknown_topic/parse_failed/wrong_address`                 |
| `kvorum_dual_write_pg_unreachable_total`  | `source`                           | `"compound_governor"`                                                             |
| `kvorum_indexer_active_sources`           | `source_type`                      | `"compound_governor"` (gauge; set at bootstrap, 0 if no rows)                     |
| `kvorum_ingestion_batch_duration_seconds` | `source`                           | `"compound_governor"` (histogram; one observation per batch)                      |

`chain_id` as a string label matches Prom conventions (labels are always strings). The pending-event-count metric uses `chain_id` (numeric-as-string) rather than `chain` (human-readable name) to match the F1 issue's metric example verbatim. Other metrics in this PR use `source` (a string label keyed on `source_type`) to align with the ADR-041 examples (`{source}`).

**Three failure modes live on dedicated counters, NOT on the `result` label** (D-F1d-5): `pg_unreachable` → `kvorum_dual_write_pg_unreachable_total`; CH-insert failures → `kvorum_archive_ch_write_errors_total`; decode failures → `kvorum_archive_decode_errors_total{reason}`. Each is the single source of truth for its failure mode; including any of them in the `result` enum too would double-count.

### Tests for `metrics.spec.ts`

Add cases asserting the eight new metrics (six counters/gauges + one histogram + `pending_event_count`) register without throwing, label sets match documentation, and `resetMetrics()` clears them (no duplicate-registration error on re-fetch). Existing spec already covers the pattern. Additional guard cases: assert that `archive_writes_total{result="pg_unreachable"}`, `archive_writes_total{result="ch_dlq_routed"}`, and `archive_writes_total{result="decode_error"}` are **never** observed — each failure mode belongs only on its dedicated counter.

### Decisions captured (F1d)

| #       | Decision                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------- | ------------------------------------------------------------------------------- |
| D-F1d-1 | Pending-depth gauge updated by periodic `count(*)` query every 10 s — owned by F1, decoupled from F2's promotion sweep                                                                                                                                                          |
| D-F1d-2 | Eight new metrics: `pending_event_count`, `archive_writes_total`, `archive_skipped_existence_total`, `archive_ch_write_errors_total`, `archive_decode_errors_total`, `dual_write_pg_unreachable_total`, `indexer_active_sources`, `batch_duration_seconds`                      |
| D-F1d-3 | `chain_id` label as string matches issue-text example; other metrics use `source` matching ADR-041; `indexer_active_sources` uses `source_type` (gauge is set once at bootstrap per source-type, not per dao_source)                                                            |
| D-F1d-4 | `archive_writes_total.result` enum mirrors `ArchiveWriteOutcome.result`: `inserted                                                                                                                                                                                              | skipped_existing | skipped_conflict | pg_dlq_routed`. Decode/CH-write/PG-unreachable each live on a dedicated counter |
| D-F1d-5 | Three failure modes are tracked ONLY on dedicated counters, never on the `result` label: `pg_unreachable` → `kvorum_dual_write_pg_unreachable_total`; CH-insert failures → `kvorum_archive_ch_write_errors_total`; decode errors → `kvorum_archive_decode_errors_total{reason}` |
| D-F1d-6 | `kvorum_ingestion_batch_duration_seconds{source}` histogram, buckets `[0.1, 0.5, 1, 2, 4, 8, 12, 16, 30]` s — boundaries straddle the 12-s tick budget so p95 readouts cleanly cross the alert threshold (OQ-F1-14)                                                             |
| D-F1d-7 | Pending-depth gauge query drops the redundant JOIN on `dao_source` — no column used from it                                                                                                                                                                                     |
| D-F1d-8 | No alerts on `kvorum_ingestion_pending_event_count` until F2 ships. F1 writes pending; F2 promotes/orphans; the gauge grows monotonically in the intervening window. Documented in the H4 metrics inventory                                                                     |

---

## F1e — Tests (consolidated)

| Spec file                                                                      | Runner | Cases                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/sources/compound/src/governor/decoder.spec.ts`                           | Vitest | 10 (decoder coverage; #6 covers scalar bigint, #6b covers bigint arrays)                                                                                                                          |
| `libs/sources/compound/src/governor/archive-writer.spec.ts`                    | Vitest | 15 (writer protocol; CH-error propagation tested at writer boundary in #8 and at listener boundary in `ingester-listener.spec.ts` #5; classifier #16 expanded for Node-level codes + 53300/08004) |
| `libs/sources/compound/src/governor/ingester-listener.spec.ts`                 | Vitest | 8 (listener orchestration; #5 covers CH-error per-event catch + counter increment)                                                                                                                |
| `apps/indexer/src/sources/compound-governor/compound-governor.service.spec.ts` | Jest   | 10 (DI + bootstrap + Drainable + shutdown order + partial-bootstrap cleanup #10)                                                                                                                  |
| `libs/chain/src/metrics/metrics.spec.ts` (additions)                           | Vitest | 10 (register/reset for 8 metrics + 3 guard cases: `pg_unreachable`/`ch_dlq_routed`/`decode_error` never on `archive_writes_total.result`)                                                         |
| `libs/chain/tests/anvil.integration.spec.ts` (additions)                       | Vitest | F1-anvil-1 (live ingest, required) · F1-anvil-2 (replay idempotency, required) · F1-anvil-3 (block_hash idempotency, required; Foundry version pin inherited from E4-anvil-2)                     |

Test-runner split mirrors the CLAUDE.md stack snapshot: Vitest for libs, Jest for NestJS apps. F1's lib primitives all run on Vitest; only the Nest service spec (`compound-governor.service.spec.ts`) needs Jest's `Test.createTestingModule` for DI assertions.

The Anvil integration tests use the same `ANVIL_RPC_URL`-gated `describeIf` pattern as E4. They require a PG test DB (`DATABASE_URL`) — already provisioned in CI per E1's smoke tests.

---

## F1f — CH migration amendment

### Scope

Amend `libs/sources/compound/migrations-clickhouse/compound_001_archive.sql` in-place. The E1 migration has not been pointed at a production CH instance; dev DBs reset via `pnpm -w db:migrate:ch` after a manual CH-side truncate of the table (documented in the M1 runbook entry below). Once M1 ships and operators run a production deployment, schema changes will follow a forward-only `ALTER TABLE` migration pattern.

### Schema delta

| Aspect          | E1 (original)                                                                | F1 (amended)                                                                                             |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PARTITION BY`  | `(chain_id, intDiv(block_number, 1000000))`                                  | `chain_id` — per-source table; under-dense partition for Compound's volume otherwise                     |
| `ORDER BY`      | `(dao_source_id, chain_id, block_number, tx_hash, log_index, block_hash)`    | `(chain_id, block_number, tx_hash, log_index, block_hash)` — aligns with G1's read shape (ADR-041 §Read) |
| `received_at`   | `DateTime64(3)` set by writer                                                | `DateTime CODEC(DoubleDelta, ZSTD(1)) DEFAULT now()` — server-stamped, sidesteps client clock skew       |
| `event_type`    | `String`                                                                     | `LowCardinality(String)` — cardinality 4 across all Compound events                                      |
| `block_number`  | `UInt64`                                                                     | `UInt64 CODEC(Delta(8), ZSTD(1))` — monotonically rising; delta compresses ~5–10×                        |
| `block_hash`    | `FixedString(66)`                                                            | `FixedString(66) CODEC(ZSTD(1))`                                                                         |
| `tx_hash`       | `FixedString(66)`                                                            | `FixedString(66) CODEC(ZSTD(1))`                                                                         |
| `dao_source_id` | `UUID` (leading in ORDER BY)                                                 | `UUID CODEC(ZSTD(1))` — kept as column for joins/labels, removed from sort key                           |
| `chain_id`      | `UInt32`                                                                     | `UInt32 CODEC(ZSTD(1))`                                                                                  |
| `payload`       | `String CODEC(ZSTD(3))` — unchanged                                          | `String CODEC(ZSTD(3))` — unchanged                                                                      |
| bloom index     | `INDEX bf_tx_hash tx_hash TYPE bloom_filter(0.01) GRANULARITY 4` — unchanged | unchanged                                                                                                |

### Rationale

- **PARTITION BY chain_id.** Per ADR-038, each source has its own CH table. Within `event_archive_compound_governor`, the only meaningful partition discriminator is `chain_id`. The original `intDiv(block_number, 1000000)` produced ~6-month partitions on Ethereum × ~60 rows each for Compound — severely under-dense. Aave/Lido migrations choose their own scheme when their volumes are known (per-source tables let us tune per source). The migration carries a comment noting this is a per-source decision: future high-volume sources should evaluate `PARTITION BY (chain_id, toYYYYMM(...))` or block-bucketing, not cargo-cult `chain_id`.
- **ORDER BY without `dao_source_id`.** Per ADR-038's per-source table layout, `dao_source_id` cardinality is ~1 per chain within this table — `WHERE dao_source_id=X` returns essentially the same rows as `WHERE chain_id=Y`. The new key `(chain_id, block_number, tx_hash, log_index, block_hash)` **supports range scans for derivation windows** (G1's typical bulk pattern: `WHERE chain_id=N AND block_number BETWEEN x AND y`). G1's IN-tuple lookups `WHERE (chain_id, tx_hash, log_index, block_hash) IN (…)` are served by the **`bf_tx_hash` bloom filter** (`tx_hash` is at position 3 in the sort key — the index can only prune on `chain_id` for such a query; the bloom filter does the heavy lifting). Compound's volume keeps both patterns cheap; the design choice matters more for high-volume sources (Aave) where the bloom filter and range-scan pruning compose.
- **Server-stamped `received_at` (`DEFAULT now()`).** Reduces client-clock-skew exposure under future multi-replica deployments, but does not eliminate it — each replica's `now()` evaluates locally, so multi-replica fan-out under network blips still produces per-replica timestamp divergence. Insert-block dedup (`insert_deduplicate=1` on `ReplicatedMergeTree`) is the real protection there; this is a follow-up when replicas land. Column type is `DateTime` (second precision); same-second re-observations of the same canonical event produce identical version values and ReplacingMergeTree's choice between them is non-deterministic — at Compound's volume (~100-200 events/yr) the collision is essentially impossible. **ADR-041 rider 2026-05-11 §3 captures this.**
- **Codecs.** Textbook Gorilla/Delta wins on monotonically-rising and high-repetition columns. `LowCardinality(String)` on `event_type` (cardinality 4) is the largest single win. Note: `UUID CODEC(ZSTD(1))` on `dao_source_id` is essentially a no-op (UUIDs are 16 random bytes — incompressible by definition); kept for per-column codec-spec consistency, but a code comment in the migration calls this out.
- **Reorg semantics preserved.** `block_hash` remains in the ORDER BY at the trailing position, so a reorg that re-emits the same `(chain_id, tx_hash, log_index)` with a different `block_hash` still produces two distinct ORDER BY tuples = two distinct rows after merge dedup. SPEC §3.3 invariant intact.

### Comment additions in the migration SQL

```sql
-- block_hash is part of ORDER BY: a reorg of the same (chain_id, tx_hash, log_index)
-- emits a second row, not a dedup. G1 supplies the canonical block_hash from
-- archive_confirmation in its IN-tuple filter (ADR-041 §Reorg semantics).

-- received_at is server-stamped (DEFAULT now()); writers MUST NOT supply it.
-- ReplacingMergeTree(received_at) keeps the row with the greatest received_at;
-- DateTime is SECOND PRECISION — same-second re-observations dedup non-deterministically.
-- Compound's volume (~100-200 events/yr) makes the collision negligible; revisit for
-- high-volume sources. Multi-replica `now()` evaluates per-replica: this reduces but
-- does not eliminate clock-skew exposure (insert-block dedup is the real fix when
-- ReplicatedMergeTree lands). (ADR-041 rider 2026-05-11 §3.)

-- PARTITION BY chain_id is a per-source decision tuned for Compound's volume.
-- Future high-volume sources (Aave/Lido) should evaluate (chain_id, toYYYYMM(...))
-- or block-bucketing — do NOT cargo-cult chain_id when the row count justifies finer
-- granularity.

-- TTL is intentionally omitted: this archive is the data plane and G1 reads it
-- indefinitely (SPEC §7.5 retention applies to PG backups, not CH). Future TTL
-- additions must key on block_number or toDate(...) of a first-observation column,
-- NOT received_at (latest-observation semantics would extend lifetime of
-- frequently-reobserved canonical events).

-- UUID CODEC(ZSTD(1)) on dao_source_id is a no-op (UUIDs are incompressible random
-- bytes); kept for per-column codec-spec consistency.
```

### No TTL — D-F1-1

The amended migration retains **no TTL clause**. The raw event archive is the data plane's reason for being; G1 reads it indefinitely. SPEC §7.5's 30-day retention applies to Postgres backups, not to the CH archive table. Storage cost at Compound steady-state is sub-MB/year. If/when retention policy changes, a follow-up migration adds a TTL clause.

### Runbook entry (manual OPTIMIZE FINAL)

Add to the M1 runbook (`docs/runbooks/`):

> ClickHouse `OPTIMIZE TABLE event_archive_<source> FINAL` is reserved for manual operator intervention. Trigger it when:
>
> 1. `system.parts` row count for a single archive table exceeds 500, **or**
> 2. immediately after a backfill run that wrote ≥ 10,000 rows in a tight window, before re-enabling derivation reads.
>
> The operation rewrites parts and can be I/O-intensive; run during a quiet derivation window. Application code MUST NOT issue `OPTIMIZE` (enforced by code review, not by a rule).

### Decisions captured (F1f)

| #       | Decision                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-F1f-1 | `PARTITION BY chain_id` — per-source table makes block-based partitioning over-granular for Compound                                                                                                                                                      |
| D-F1f-2 | `ORDER BY (chain_id, block_number, tx_hash, log_index, block_hash)` — drop `dao_source_id`; matches G1's filter shape                                                                                                                                     |
| D-F1f-3 | `received_at DateTime DEFAULT now()` — server-stamped at second precision. Reduces (does not eliminate) clock-skew exposure; same-second collisions are non-deterministic but negligible at Compound's volume. Migration comment documents the limitation |
| D-F1f-4 | Add Delta+ZSTD codecs on numerics, ZSTD on hashes/UUID, LowCardinality on `event_type` — ~5× expected size reduction at scale                                                                                                                             |
| D-F1f-5 | No TTL clause; archive is permanent. SPEC §7.5 retention applies to PG backups, not CH archive                                                                                                                                                            |
| D-F1f-6 | Migration edited in-place (E1 has not been pointed at production CH); future schema changes follow forward-only ALTER pattern                                                                                                                             |
| D-F1f-7 | Operator runbook entry for manual `OPTIMIZE TABLE … FINAL` triggers (≥500 parts or post-backfill ≥10k rows)                                                                                                                                               |

---

## Bootstrap & wiring summary

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ apps/indexer (NestApplicationContext)                                          │
│                                                                                 │
│   AppModule ─┬─ DatabaseLifecycleModule ─ DatabaseLifecycleService             │
│              │      └─ OnApplicationShutdown: drainables.drainAll() → pgDb.destroy() │
│              │                                                                  │
│              │── DrainableRegistry (singleton; source services self-register)  │
│              │                                                                  │
│              └─ IndexerModule ─ CompoundGovernorModule                          │
│                                  ├─ CompoundGovernorService                     │
│                                  │    ├─ OnApplicationBootstrap:                │
│                                  │    │     • parseChainConfigFromEnv          │
│                                  │    │     • SELECT * FROM dao_source         │
│                                  │    │     • new FailoverRpcClient (per chain)│
│                                  │    │     • new EventPoller (per dao_source) │
│                                  │    │     • poller.onEvents(listener)        │
│                                  │    │     • poller.start()                   │
│                                  │    └─ OnApplicationShutdown:                │
│                                  │          await Promise.allSettled(stops)   │
│                                  │                                              │
│                                  ├─ ArchiveWriter (singleton)                   │
│                                  │    • deps: pgDb, chDb, logger                │
│                                  │    • method: write(ctx, decoded, logRef)    │
│                                  │                                              │
│                                  └─ PendingDepthGaugeService                    │
│                                       • @Interval(10_000) recompute             │
└────────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ EventPoller filtered to (governor_address, [4 topics])
                  ┌─────────────────────────────────────────────────────┐
                  │ eth_getLogs over 2×reorgHorizon window every 12 s   │
                  └─────────────────────────────────────────────────────┘
                              │
                              ▼ LogEvent[]
                  ┌─────────────────────────────────────────────────────────────────┐
                  │ ingester-listener (sequential per event):                       │
                  │   try { decode } catch DecodeError → stage='archive_decode' DLQ │
                  │   try { archiveWriter.write } catch (CH error) → log + counter; │
                  │     batch continues (per-event isolation, ADR-041 2026-05-12)   │
                  └─────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴───────────────┐
                ▼                              ▼
   ┌───────────────────────────┐   ┌──────────────────────────────────┐
   │ ClickHouse (② CH insert)  │   │ Postgres                          │
   │  event_archive_compound_  │   │  ① SELECT archive_confirmation    │
   │  governor (Replacing      │   │     (5-tuple, status-agnostic)    │
   │  MergeTree(received_at);  │   │  ③ INSERT archive_confirmation    │
   │  DEFAULT now())           │   │       ON CONFLICT DO NOTHING      │
   │  on fail → exception      │   │  ④ INSERT ingestion_dlq on fail   │
   │  propagates to listener   │   │      (stage='archive_confirmation_│
   │  (no CH-DLQ branch)       │   │       write' only)                │
   └───────────────────────────┘   └──────────────────────────────────┘
```

---

## PR breakdown

**Recommended: single PR**, ~1100 LOC + ~1400 LOC tests. Mirrors E4's single-PR shape. Split fallback if review stalls > 24 h: split at the F1a/F1b boundary (decoder is structurally independent of writer).

PR title: `feat(indexer): F1 — Compound Governor adapter + archive writer (polling, idempotent)`

PR body:

```
Closes #29
Part of epic #44

## Summary
- F1a — Compound Governor ABI fragment (4 events) + decoder in `libs/sources/compound/src/governor/`;
  topic0 hashes derived from ethers Interface; payload normalisation rules documented;
  explicit bigint-array `.map(.toString())` snippet
- F1b — ArchiveWriter + makeIngesterListener in `libs/sources/compound/src/governor/`
  (framework-agnostic plain classes, no @Injectable). Implements ADR-041 + 2026-05-11
  rider §1/§3/§4 + 2026-05-12 retraction of §2: PG existence check (5-tuple,
  status-agnostic) → CH insert (errors propagate to listener) → PG insert with
  transient-error retry 3×[200ms,600ms,1.8s] → DLQ stage='archive_confirmation_write'
  on permanent/exhausted → pg_unreachable counter on DLQ-insert failure. DLQ payload
  is raw-only (raw log + 5-tuple); decode on retry. Transient-error allowlist extended
  with Node-level codes + 53300/08004
- F1c — `apps/indexer/src/sources/compound-governor/` thin Nest wrapper. CompoundGovernorModule
  registers ArchiveWriter via `useFactory` provider and consumes makeIngesterListener
  from the lib. CompoundGovernorService wires N EventPollers (one per dao_source)
  sharing a per-chain FailoverRpcClient; dao_source.source_config parsed via zod;
  bootstrap pre-validates all source_configs before starting clients AND wraps starts
  in a try/catch that stops already-started clients on failure; DrainableRegistry +
  DatabaseLifecycleService for ordered shutdown; listener catches CH errors per-event
  so a single CH glitch doesn't drop the rest of the batch
- F1d — Eight new metrics: pending_event_count, archive_writes_total,
  archive_skipped_existence_total, archive_ch_write_errors_total,
  archive_decode_errors_total, dual_write_pg_unreachable_total,
  indexer_active_sources, batch_duration_seconds (histogram with buckets
  straddling the 12-s tick budget)
- F1e — Decoder/writer/listener/service specs (Vitest + Jest as per layer) +
  F1-anvil-1 live-ingest + F1-anvil-2 replay idempotency + F1-anvil-3 block_hash
  idempotency integration tests (all required; Foundry version pin inherited from E4)
- F1f — CH migration amendment: PARTITION BY chain_id, ORDER BY without dao_source_id,
  Delta/ZSTD codecs, server-stamped DateTime received_at (second precision —
  collision-negligible at Compound's volume), no TTL; runbook entry for manual
  OPTIMIZE FINAL. Includes ADR-041 rider 2026-05-12 retracting §2 (archive_ch_write
  DLQ stage)

## Decisions carried from plan
(table — Dn entries)

## Test plan
- pnpm -w format:check && lint && typecheck && test — green
- decoder.spec.ts — 10 cases
- archive-writer.spec.ts — 15 cases
- ingester-listener.spec.ts — 8 cases
- compound-governor.service.spec.ts — 10 cases
- metrics.spec.ts (additions) — 10 cases
- anvil.integration.spec.ts F1-anvil-1, F1-anvil-2, F1-anvil-3 — green when ANVIL_RPC_URL set
```

---

## Acceptance

From issue #29 verbatim:

- ✅ Pointed at Ethereum mainnet via free-tier RPC, the indexer produces `event_archive_compound_governor` rows for live `ProposalCreated` / `ProposalQueued` / `ProposalExecuted` / `ProposalCanceled` events within ~12 s of block confirmation (F1-anvil-1 simulates this; real mainnet smoke test is a manual step in the runbook)
- ✅ Idempotency exercised: replay historical logs (F1-anvil-2 — **required**). Same event under two different `block_hash` values produces two distinct rows (F1-anvil-3 + writer spec #15)
- ✅ Metric `kvorum_ingestion_pending_event_count{chain_id="1",source_type="compound_governor"}` exposes pending depth (F1d + metrics.spec.ts)

Epic-level forward-progress (per #44 epic body):

- ⏳ Reorg correctness: F2 + F3
- ⏳ Promotion sweep to `confirmed`: F2
- ⏳ DLQ accumulation under deliberate fault injection: F3 (F1 provides the DLQ path; F3 exercises it)

---

## Risks

- **ADR-041 protocol drift.** The PG-first / CH-then-PG / retry / DLQ ordering is easy to mis-implement in a way that passes happy-path tests but corrupts state under partial failure (e.g. skipping the existence check, or DLQ-ing before retry exhaustion). Mitigation: writer spec covers all five outcome states + the PG-DLQ path + the DLQ-unreachable path. Code review focuses on the step-by-step block. ADR-041 + 2026-05-11 rider §1/§3/§4 + 2026-05-12 retraction of §2 together form the authoritative contract.
- **Permanent error + DLQ-unreachable loop (unbounded in F1).** If step 3 routes to DLQ with a permanent error AND step 4 finds PG unreachable for the DLQ insert, the next tick's existence check finds nothing in PG, re-inserts to CH (ReplacingMergeTree absorbs the duplicate at merge time), then re-attempts step 3 with the same permanent error and the same DLQ-unreachable condition. **This loop is unbounded in F1** — it terminates only when (a) PG recovers and the DLQ insert succeeds, (b) the underlying permanent error is fixed (FK target, CHECK constraint), or (c) the operator intervenes. F1 does not add a circuit-breaker; `kvorum_dual_write_pg_unreachable_total` increments per iteration, giving operators a monotonic alert signal. CH writer-side amplification is bounded by ClickHouse's server-side `async_insert` buffer (configured in `libs/db/src/client.ts:30-32` with `async_insert=1, wait_for_async_insert=1`). M1 accepts this window per ADR-041 §Reconciliation; M2's reconciliation job closes it.
- **CH `received_at` semantics + second precision.** ReplacingMergeTree(received_at) keeps the **most recent** observation per ORDER BY tuple. The column is `DateTime DEFAULT now()` (D-F1f-3, second precision), so CH stamps it on receipt — F1's repeated re-observation of the same canonical event across polling ticks produces a non-strictly-monotonically-advancing `received_at` (same-second re-observations collide). At Compound's volume (~100-200 events/yr) the collision is negligible, and the ReplacingMergeTree choice between equal-version rows is still a valid observation of the same canonical event. Risk: G1 or downstream consumers misread `received_at` as "first observation." Mitigation: clarifying comment in the migration SQL (D-F1f §Comment additions) + runbook note that `received_at = latest observation, second precision`.
- **Reorg-related RPC amplification.** EventPoller's sliding `2 × reorgHorizon` window normally produces ~1 `eth_getLogs` + 1 `eth_blockNumber` per 12-s tick. During a reorg, the rewound window is re-fetched on the next tick — RPC call volume doubles briefly. Ethereum mainnet sees small (1-block) reorgs roughly weekly; the amplification is bounded by `2 × reorgHorizon` blocks. Failover behavior under sustained 429s: `FailoverRpcClient`'s circuit breaker rotates to the next provider, and the daily-quota counter is per-provider, so a flapping high-priority provider can push total quota usage higher than the per-provider sum. Mitigation: monitor `kvorum_chain_rpc_rate_limited_total{provider}` (already shipped in E2) and re-evaluate provider mix if a single day exceeds expectations.
- **PG and CH seeing different reorgs (F2 dependency).** F1 may write `pending` rows for block N (later orphaned by F2) AND for block N' (the canonical replacement) on subsequent ticks. The schema permits this — the partial unique `idx_archive_confirmation_canonical` allows two rows for the same `(chain_id, tx_hash, log_index)` if at most one is non-orphaned, and the full 5-tuple unique permits both because `block_hash` differs. **F2's promotion sweep must handle sibling `pending` rows** for the same `(chain_id, tx_hash, log_index)` — promoting both would violate the canonical partial unique. F1 does not address this directly; flagged here as a forward-link to F2's design.
- **`description` field size.** Compound proposals occasionally embed very long markdown (10s of KB). Both PG `text` (no limit beyond 1 GB) and CH `String CODEC(ZSTD(3))` handle this fine. Worth measuring: typical proposal description is < 5 KB; worst-case ~50 KB. No additional schema action needed.
- **Bigint serialisation.** `JSON.stringify(bigint)` throws. The decoder pre-converts bigints to decimal strings (scalar + array — see F1a explicit snippet); the writer's `JSON.stringify(payload)` operates on strings only. Spec tests #6 and #6b guard the boundary for scalars and arrays respectively.
- **Free-tier RPC quota.** Each EventPoller burns one `eth_getLogs` + one `eth_blockNumber` per 12-s tick = 14400 calls/day per source per RPC provider. Compound is one source on mainnet, so ~14 k calls/day. Comfortable within free-tier limits (Alchemy 300 M/mo, Ankr 500 RPS public).
- **PG connection pool exhaustion.** Three concurrent operations per write (existence check, CH insert is non-PG, PG insert) plus the pending-gauge query every 10 s. At 12-s tick × ~1 event/tick steady-state × 3 PG ops = ~0.25 PG ops/s. Pool size (Kysely default 10) is over-provisioned. Risk: backfill (Epic I) will spike this — capacity-plan in I.
- **Test flakiness from backoff timing.** Real backoffs `[200, 600, 1800]` ms make tests slow. Mitigation: `retryBackoffMs: [0, 0, 0]` in specs. The backoff _count_ (3) is the meaningful contract, not the _duration_.
- **Generic abstraction premature.** Writing `EVMEventIngester<TPayload>` now would speed up Aave/Lido in M3/M4 but complicates the F1 review surface. Mitigation: deferred. F1 ships Compound-specific; M3's first task is to extract the generic shape from F1 + Aave duplication.
- **Reload-after-restart UX.** Adding a new `dao_source` row at runtime requires a process restart. Acceptable for M1 (operator-driven, infrequent). Not a risk per se; documented as D-F1c-4.

---

## Out of scope (forward-link)

- **Promotion sweep (`pending → confirmed`).** F2.
- **Reorg orphaning (`pending → orphaned` + `reorg_event` write).** F2. F1 does NOT instantiate `HeadTracker` or `ReorgDetector`.
- **F2 must handle sibling `pending` rows for the same `(chain_id, tx_hash, log_index)`.** F1 may write canonical and orphaned-block variants in adjacent ticks; the schema permits both. F2's promotion logic needs to pick the canonical sibling and orphan the others before promoting — flagged here as a forward-link.
- **DLQ row cleanup when underlying event succeeds on retry.** A DLQ row written under `stage='archive_confirmation_write'` whose underlying event succeeds on a later tick remains in the table as a stale tombstone. Epic I's `admin-cli dlq retry` is the cleanup path — it must mark the row resolved when the existence check returns a row (i.e., outcome `skipped_existing` on retry). F1 does not implement DLQ housekeeping.
- **Anvil synthetic-reorg test exercising all 5 SPEC §3.4 assertions.** F3.
- **DLQ fault-injection test.** F3 — F1 implements the DLQ insert path; F3 deliberately fails a write to verify accumulation.
- **`admin-cli dlq retry` / `dlq accept`.** Epic I per ADR-032.
- **Generic `EVMEventIngester<T>`.** M3 (Aave) refactor — extracted from `libs/sources/compound/src/governor/` + `libs/sources/aave/src/<contract>/` duplication into a shared package (`libs/sources/_common/` or `libs/chain/ingester/`) once two concrete sources exist to inform the abstraction.
- **Live-reload of `dao_source` rows without restart.** M2/M3 feature; current architecture is restart-required.
- **WebSocket-driven log subscription.** v1.x per ADR-037.
- **Backfill driver.** Epic I — reuses F1's `decodeCompoundLog` + a different writer (ADR-027: writes `confirmation_status='confirmed'` directly).
- **G1 reading payloads with `SELECT … FINAL`.** G1 — ADR-041 read protocol.
- **M2 reconciliation job (CH-orphan sweep / PG-orphan sweep).** M2 deliverable per ADR-041.
- **CToken proxy slot `0x3` resolution for calldata decoding.** G2 — proxy resolver is a separate concern (E4).

---

## Open questions for negotiation

| #        | Question                                                                                                                                                                               | Recommendation                                                                                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| OQ-F1-1  | ABI fragment in `libs/sources/compound/src/events.ts` (canonical home) or `apps/indexer/src/sources/compound-governor/abi.ts` (issue text hint)?                                       | **libs/sources/compound.** Issue text predates the libs/sources/<source> structure that already exists for migrations + choices. Cleaner.                                                                                                                     |
| OQ-F1-2  | DLQ implemented in F1 (per ADR-041) or deferred to F3 (per F1 issue text "DLQ wiring deferred to F3")?                                                                                 | **F1.** ADR-041 was accepted on 2026-05-10, after the F1 issue text. The retry-then-DLQ logic is naturally coupled to the write path; separating creates artificial seams. F3 exercises end-to-end with fault injection but F1 ships the code.                |
| OQ-F1-3  | Decode errors → DLQ (`stage='archive_decode'`) or log+drop?                                                                                                                            | **DLQ.** Volume is expected to be zero under normal operation; surfaces contract upgrades / RPC bugs. Cost: ~30 LOC.                                                                                                                                          |
| OQ-F1-4  | Pending-depth gauge updated by periodic count query or per-write increment + F2 decrement?                                                                                             | **Periodic count.** Self-contained primitive; decoupled from F2's promotion sweep. Cost: one cheap query per 10 s.                                                                                                                                            |
| OQ-F1-5  | Set up `HeadTracker` + `ReorgDetector` in F1 (forward-compat with F2) or strictly in F2?                                                                                               | **Strictly F2.** F1's scope is "pending rows from polled logs." F2 adds the head-tracking layer on top of F1's RPC client.                                                                                                                                    |
| OQ-F1-6  | `@nestjs/schedule` `@Interval` for the gauge updater, or plain `setInterval`?                                                                                                          | **Plain `setInterval`** with cleanup in `OnApplicationShutdown`. Avoids adding a NestJS module dep for a single 10-s interval.                                                                                                                                |
| OQ-F1-7  | F1 ships as one PR or split (F1a vs F1b+F1c+F1d)?                                                                                                                                      | **One PR.** Matches E2/E3/E4 single-PR cadence. Split if review stalls > 24 h.                                                                                                                                                                                |
| OQ-F1-8  | Live-reload `dao_source` rows without restart?                                                                                                                                         | **No** for M1. Restart-required. Document in runbook.                                                                                                                                                                                                         |
| OQ-F1-9  | DLQ row payload: decoded fields only, decoded + raw, or raw only?                                                                                                                      | **Raw only** `{ raw: { topics, data }, reason? }` + decode on retry. Smallest rows; chain as single source of truth; exercises decoder on retry. Operator forensics via `admin-cli dlq inspect <id>` (Epic I). Ratified by ADR-041 rider 2026-05-11 §4.       |
| OQ-F1-10 | Generic `EVMEventIngester<T>` in F1 or defer to M3 when Aave provides the second concrete?                                                                                             | **Defer.** Compound-specific in F1; refactor when Aave lands. Avoids speculative abstraction.                                                                                                                                                                 |
| OQ-F1-11 | `archive_writes_total.result` label values: tagged-union mirror or a flatter enum? Conflict with `kvorum_dual_write_pg_unreachable_total`?                                             | **Tagged-union mirror minus failure modes that live on dedicated counters.** `result` enum: `inserted                                                                                                                                                         | skipped_existing | skipped_conflict | pg_dlq_routed`. `pg_unreachable`, CH-insert failures, and decode errors each have their own dedicated counter (D-F1d-5). Avoids double counting. |
| OQ-F1-16 | (added 2026-05-12) Original ADR-041 rider §2 routed CH-insert errors to DLQ with `stage='archive_ch_write'`. Review surfaced that next-tick CH recovery produces stale DLQ tombstones. | **Retract rider §2.** CH errors propagate to the listener; per-event try/catch isolates CH glitches without creating DLQ rows. Tracked on dedicated `kvorum_archive_ch_write_errors_total{source}`. ADR-041 amended 2026-05-12.                               |
| OQ-F1-12 | Use `dao_source.id` (UUID) or `dao_source.dao_id` (UUID, joins to dao.slug) as the EventPoller `daoSourceLabel`?                                                                       | **dao_source.id.** Already what E3's spec assumes. Stable across dao renames.                                                                                                                                                                                 |
| OQ-F1-13 | F1-anvil-3 (block_hash idempotency) — must-have or nice-to-have?                                                                                                                       | **Required.** Promoted from recommended; SPEC §3.3 invariant. F3 covers it end-to-end but F1's guard is cheaper to fail-fast.                                                                                                                                 |
| OQ-F1-14 | Listener behavior when EventPoller delivers a large batch (cold-start / busy day) that exceeds the 12-s tick budget?                                                                   | **Accept the overlap** for M1 (Compound steady-state is 0–3 events/tick; cold-start is backfill's responsibility per Epic I). Add `kvorum_ingestion_batch_duration_seconds{source}` histogram (D-F1d-6) so operators can monitor and act on widening overlap. |
| OQ-F1-15 | Bootstrap interleaves source_config validation with RPC client startup — if source N is misconfigured, N-1 clients have already burned RPC quota.                                      | **Pre-validate ALL source_configs first** (D-F1c-13). Two-pass bootstrap: validate every source, then start clients. ~20 LOC.                                                                                                                                 |

---

## Definition of done

- All four pre-commit checks green (`format:check`, `lint`, `typecheck`, `test`)
- `pnpm -w test` covers the new specs (decoder, writer, listener, service, metrics)
- `pnpm -w test:integration` (when `ANVIL_RPC_URL` is set in CI) covers F1-anvil-1, F1-anvil-2, F1-anvil-3 (all required)
- `apps/indexer` boots against an empty `dao_source` table, logs the "indexer will idle" message, and shuts down cleanly on SIGTERM
- `apps/indexer` boots against the seeded `dao_source` row for Compound + a `CHAIN_CONFIG` env with one Ethereum mainnet entry, and starts an EventPoller for it
- A manual mainnet smoke (per runbook) produces ≥ 1 `event_archive_compound_governor` row within 15 min when Compound emits a governance event (or the runbook notes "no live event observed during smoke window" if the period was quiet — Compound proposals are infrequent)
- `pnpm -w typecheck` passes including the new types (`CompoundGovernorEvent`, `ArchiveWriteOutcome`, etc.)
- ADR-041 rider 2026-05-11 (§1, §3, §4) + 2026-05-12 retraction of §2 are both committed alongside the PR
- CH migration `compound_001_archive.sql` reflects F1f schema (PARTITION BY chain_id, ORDER BY without dao_source_id, codecs, `DateTime DEFAULT now()` received_at), with the documented comment block in the SQL (per-source partition note, second-precision caveat, TTL guidance, UUID-codec no-op note)
- Runbook entry for manual `OPTIMIZE TABLE … FINAL` triggers landed in `docs/runbooks/`
- `libs/sources/compound/src/governor/` exists with decoder + writer + listener + types + `index.ts` re-exports; package root `src/index.ts` re-exports the governor subpackage so `@libs/sources-compound` is the single import path (no new tsconfig/webpack alias needed for F1)
- `libs/sources/compound/package.json` does NOT add `@nestjs/common` as a dependency. New deps for F1: `ethers` (decoder uses `Interface.parseLog`), `@libs/chain` (workspace dep — writer/listener call `getArchiveWritesTotal()` etc. from `libs/chain/src/metrics/`). `prom-client` is transitive via `@libs/chain`. `zod` (used by `DaoSourceConfig` parsing) lives in apps/indexer, not the lib
- CLAUDE.md updated: module-boundaries table gains a `libs/sources/<source>` row (depends on domain, db, chain, utils — explicitly framework-agnostic); "Where things live" gets the per-source layout note
- Metrics inventory (to land formally in H4's `docs/metrics.md`, enumerated here for the record):
  - `kvorum_ingestion_pending_event_count{chain_id,source_type}` — gauge (no alerts until F2 ships; documented in D-F1d-8)
  - `kvorum_ingestion_archive_writes_total{source,result}` — counter (result enum: `inserted | skipped_existing | skipped_conflict | pg_dlq_routed`)
  - `kvorum_archive_skipped_existence_total{source}` — counter
  - `kvorum_archive_ch_write_errors_total{source}` — counter (CH-insert failures caught by listener)
  - `kvorum_archive_decode_errors_total{source,reason}` — counter (DecodeError occurrences)
  - `kvorum_dual_write_pg_unreachable_total{source}` — counter (single source of truth for DLQ-unreachable)
  - `kvorum_indexer_active_sources{source_type}` — gauge (set once at bootstrap; 0 = misconfiguration)
  - `kvorum_ingestion_batch_duration_seconds{source}` — histogram (buckets straddle 12-s tick: 0.1, 0.5, 1, 2, 4, 8, 12, 16, 30)
- PR merged to `main`; issue #29 closed; epic #44's `F1` checkbox ticked

---

## Approval gate

Per repo convention: this plan lands as `docs/plan-m1-f1.md` and waits for explicit go-ahead. No code is written until this plan is approved or amended.

Reply with go / no-go, or comment inline on the **Open questions for negotiation** table.
