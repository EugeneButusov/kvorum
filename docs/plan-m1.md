# M1 — Compound proposals end-to-end — execution plan

**Status:** draft, awaiting approval — no GitHub issues will be opened until the breakdown is locked
**Owner:** Eugene
**Date:** 2026-05-10 (revised: 5-epic restructure)
**Spec reference:** [SPEC §10.3 — M1 — Compound proposals end-to-end](./SPEC.md#103-m1--compound-proposals-end-to-end)
**Milestone:** [M1 — Compound proposals end-to-end](https://github.com/EugeneButusov/kvorum/milestone/2) (created)
**Estimated duration:** 2 working weeks (~10–11 focused days; ~15.5 raw effort, parallelism reduces)

---

## Why this milestone, why now

M1 is the first milestone with product semantics. M0 produced an empty workspace; M1 produces the first vertical slice — Compound proposals, indexed from RPC, archived with full reorg auditing, derived to a normalized core entity, decoded for calldata, and served behind an authenticated REST API with documented OpenAPI. Two weeks, one DAO, one source type.

The risk-front-loading rationale (SPEC §10.3 / §10.0) is the core argument for going hard on this milestone:

- **Reorg correctness** is exercised here for the first time. Get it wrong now, discover it months later. The Anvil synthetic-reorg test is the M1 acceptance gate that forces the issue.
- **Append-only archive + derive-from-confirmed-only** is the load-bearing simplification of the whole ingestion design. M1 is where that pattern lands and is proven.
- **API surface conventions** (auth, rate limiting, RFC 7807, cursor pagination, ETag, OpenAPI) are committed in M1 and inherited by every later milestone. Doing them once, correctly, here is cheaper than retrofitting.

This is also the **earliest milestone whose output is partially demoable**: a curl against the public proposal endpoint returning ~300 historical Compound proposals with decoded calldata is a real artifact, even if the dashboard is still M6 territory.

---

## Scope

### In scope (verbatim from SPEC §10.3)

- `libs/chain`: RPC abstraction with multi-provider failover, circuit breakers, EIP-1967 proxy resolution
- Compound Governor source adapter (`apps/indexer/sources/compound-governor`): `ProposalCreated`, `ProposalCanceled`, `ProposalExecuted`, `ProposalQueued` events
- Append-only event archive Postgres schema (per SPEC §3.2)
- Reorg detection and handling per SPEC §3.4: confirmation-status transitions, `reorg_event` table, append-only invalidation
- `proposal` core entity derivation from confirmed archive events
- ABI decoding pipeline (SPEC §3.8): bundled selector index, bundled ABI library, local-first decoding, optional Etherscan enrichment
- API endpoints: `GET /v1/daos/{slug}/proposals`, `GET /v1/daos/{slug}/proposals/{type}/{id}` (plus the smaller surface listed in Epic H)
- API auth (Bearer + HMAC-SHA256 per ADR-025), rate limiting, ETag caching, RFC 7807 error model
- OpenAPI spec generated and served at `/v1/openapi.json`; committed to `docs/openapi.json` on release

### Acceptance criteria (M1 gate)

1. All historical Compound binding proposals indexed (~300 proposals)
2. New proposals appear in the API within 4 minutes of execution on Ethereum mainnet
3. **Reorg test passes:** Anvil-forked mainnet with synthetic reorg at known block; events transition `pending` → `confirmed` and `pending` → `orphaned` correctly; no data is silently mutated
4. Calldata decoded for >95% of proposals (the long tail can remain `decoded_function = NULL`)
5. API returns proposal entities with the response shape committed in SPEC §4.7 (data wrapper, `_meta`, `_meta.confirmed: true`, `_meta.links`)
6. API latency: p95 < 500ms on warm cache for entity GETs

### Out of scope for M1 (forward-link to later milestones)

- **Votes / `VoteCast` / voting power snapshots** — M2 per SPEC §10.4
- **Delegations / `DelegateChanged` / `DelegateVotesChanged`** — M2
- **Actor merging machinery + `actor_address_redirect` table (ADR-033)** — M2 (the `actor` table itself ships in M1 with proposer-only population)
- **Aave + Lido sources** — M3, M4
- **Snapshot / Aragon / Dual Governance** — M4
- **AI features (summarization, mismatch detection, embeddings, forum synthesis)** — M5
- **Dashboard pages** — M6
- **SIWE / email signup / developer dashboard auth UI** — M6 (M1 mints API keys via `admin-cli keys create`, not via a user-facing flow)
- **ClickHouse analytical mirror layer** (`vote_events_flat`, `delegation_flow_flat`) — deferred per ADR-038 (which preserves ADR-026's analytical-mirror activation triggers; supersedes ADR-026's blanket deferral). The **archive layer** ships in M1 — see Epic E1.
- **Adaptive polling client (ADR-035)** — M6 (dashboard concern)
- **Forum ingestion / `forum_thread`** — M4

---

## Active ADRs in M1

| ADR                                                     | Title                                                                             | M1 application                                                                                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-022](./adr/0022-voting-power-block-snapshot.md)    | `voting_power_block` populated for Snapshot proposals                             | Schema includes the field; populated for Compound from `ProposalCreated.startBlock`; Snapshot path lands in M4                                                                        |
| [ADR-025](./adr/0025-credential-hashing.md)             | API keys: HMAC-SHA256(pepper, key); passwords: argon2id                           | Direct: API key auth middleware + `api_keys` schema                                                                                                                                   |
| [ADR-027](./adr/0027-backfill-confirmation-cutoff.md)   | Backfill confirmation cutoff = `chain_head_at_backfill_start − reorg_horizon`     | Direct: Epic I's backfill driver; `dao_source.backfill_started_at_block` field added                                                                                                  |
| [ADR-028](./adr/0028-secrets-vault.md)                  | Off-host secrets vault (1Password)                                                | Operational: HMAC pepper, RPC keys, Etherscan key (optional) sourced via `infra/scripts/provision-env.sh`; runbook updates                                                            |
| [ADR-030](./adr/0030-title-extraction.md)               | Per-source title extraction rules                                                 | Direct: per-source `compound_governor` extractor lives at `libs/sources/compound/` (re-homed from `libs/domain/title-extractor.ts` per source-package boundary; see plan-m1-e1.md v4) |
| [ADR-032](./adr/0032-dlq-accept-semantics.md)           | `dlq accept` is permanent acknowledgement, not retry                              | Direct: `admin-cli dlq accept` semantics + `ingestion_dlq_resolved` archive table                                                                                                     |
| [ADR-037](./adr/0037-defer-websocket-ingestion.md)      | Defer WebSocket ingestion to v1.x; v1 uses polling only                           | Direct: simplifies E3 to polling-only; head tracking via polled `eth_getBlockByNumber('latest')`                                                                                      |
| [ADR-038](./adr/0038-clickhouse-archive-layer-in-m1.md) | Split ClickHouse archive layer from analytical mirror; archive ships in M1        | Direct: E1 schema includes ClickHouse `event_archive_compound_governor` table + Postgres `archive_confirmation` tracker; supersedes ADR-026                                           |
| [ADR-039](./adr/0039-compound-choice-ordering.md)       | Compound choice ordinal mapping aligns with on-chain `castVote` enum              | Direct: G1 inserts `(0,'Against'),(1,'For'),(2,'Abstain')` per Compound proposal — overrides SPEC §2.4.6                                                                              |
| [ADR-040](./adr/0040-replace-prisma-with-kysely.md)     | Replace Prisma with Kysely; ClickHouse migrations via `clickhouse-migrations` npm | Direct: PR-0 of E1 swaps the ORM; all subsequent DB code uses Kysely                                                                                                                  |
| [ADR-041](./adr/0041-cross-db-integrity-contract.md)    | Cross-DB integrity contract (PG-first existence check, CH-then-PG write order)    | Direct: F1 write protocol; G1 read protocol with `SELECT ... FINAL`; M2 reconciliation deliverable                                                                                    |

ADR-033 (actor merge redirects) is referenced but not active in M1 — the `actor_address_redirect` table is created in M2 alongside the `actor merge` admin command.

---

## Epic table at a glance

| Epic | Title                                                      | Tasks | Estimate   | Critical-path?                                             |
| ---- | ---------------------------------------------------------- | ----- | ---------- | ---------------------------------------------------------- |
| E    | M1 schema + chain client library                           | 4     | ~2.75 days | yes (gates everything)                                     |
| F    | Compound Governor ingestion + reorg                        | 3     | ~3 days    | yes (gates G, blocks acceptance #2/#3)                     |
| G    | Derivation + ABI decoding                                  | 2     | ~2.5 days  | partial (blocks acceptance #4/#5)                          |
| H    | API surface (auth, rate limit, errors, endpoints, OpenAPI) | 6     | ~4.5 days  | partial (parallelizable with F/G; blocks acceptance #5/#6) |
| I    | Backfill orchestration + admin CLI wiring                  | 3     | ~2 days    | yes (blocks acceptance #1)                                 |

**Total raw effort:** ~14.5 days. **With parallelism:** ~10 working days. **18 tasks across 5 epics.**

### Dependency graph

```
E ──┬─ F ─── G ──┐
    │            │
    └─ H ────────┴── F end ─ I ── M1 done
```

E (schema + chain lib) is the gate. F and H run in parallel after E. G blocks on F. I blocks on E + F (uses the same archive writer + chain client). H can be largely scaffolded against fixtures in parallel with F/G; the conformance test (H6) needs G's output to validate against real data.

### Recommended execution order (single-developer)

1. **E** alone, ~3.5d. Schema first (E1), then chain client (E2–E4). Both gate everything else.
2. **F + H in parallel** (or sequentially F→H if only one track at a time), ~7.5d combined. F unblocks G; H unblocks consuming the proposal data via API.
3. **G**, ~2.5d. Slots in once F is producing confirmed events.
4. **I**, ~2d. Closing operational layer; runs the backfill and validates acceptance criteria.

Calendar slack: budget 2–3 days for unknowns (RPC provider quirks, Anvil reorg fixture authoring, OpenAPI generator footguns). Realistic wall-clock: ~12–13 working days.

---

## Cross-cutting concerns

**Observability threaded through every epic.** Each epic emits Prometheus metrics under its committed namespace (`kvorum_ingestion_*` for E/F/I, `kvorum_derivation_*` for G, `kvorum_api_*` and `kvorum_rate_limit_*` for H, `kvorum_dlq_*` for F/I, `kvorum_db_*` baseline). `docs/metrics.md` is initialized in Epic H (alongside the `/metrics` endpoint) and appended to as later epics add metric families. The Grafana dashboards themselves don't ship until M7 — M1 only commits the metric _contract_.

**Structured logging.** Required fields per SPEC §7.4: `timestamp`, `level`, `service`, `request_id` (where applicable), `message`. Optional: `dao_id`, `proposal_external_id`, `error`. Established in Epic H and reused everywhere.

**DLQ wiring.** `ingestion_dlq` is wired in F; `admin-cli dlq` commands wired in I. The first end-to-end DLQ exercise is intentional fault-injection during the Anvil reorg test (Epic F).

**Service boundaries (open question carried from M0).** Per the M0 review, `derivation` and `scheduler` start as modules inside `apps/indexer` until workload justifies splitting them out. M1 keeps that posture: the derivation worker (Epic G) is a NestJS module imported by `apps/indexer`'s standalone context; the confirmation promotion sweep cron lives in the same process. If load testing during Epic I shows contention, an ADR codifies the split — but the default plan is no split.

**Where to put code.** Per CLAUDE.md module boundaries: ingestion adapters and derivation modules under `apps/indexer/src/`; chain client under `libs/chain`; domain types and title extractor under `libs/domain`; Prisma models under `libs/db`; ABI library + selector index under `libs/chain/abi/` (initial location; promotable if it grows).

---

## Epic E — M1 schema + chain client library

**Estimated effort:** ~2.75 days (schema ~1.5d + chain lib ~1.25d)
**Depends on:** M0 (Prisma initialized, `libs/db` + `libs/chain` skeletons exist)
**Gates:** F, G, H, I (everything downstream)

### Purpose

Two bodies of infrastructure work that gate everything downstream, grouped into one epic because nothing further can land without both:

- **Schema (E1)** — every Postgres table M1 reads or writes, plus the Compound `dao` + `dao_source` seed. Migrations live in `libs/db/prisma/schema.prisma`, applied via `pnpm -w db:migrate:dev`.
- **Chain library (E2–E4)** — the EVM RPC abstraction every source ingester sits on top of. The lib is general (multi-chain, source-agnostic) — Compound is its first consumer in F; Aave/Lido reuse it in M3/M4. Multi-provider failover, circuit breakers, polling-based event ingestion + head tracking (per ADR-037 — WebSocket deferred to v1.x), EIP-1967/EIP-1822/Transparent proxy resolution, and the sliding-window block-hash tracker that drives reorg detection.

### Spec / ADR references

- SPEC §2.4 (core entities)
- SPEC §2.6 (raw event archive shape)
- SPEC §3.2 (event lifecycle fields)
- SPEC §3.3 (EVM ingestion — polling-only in v1 per ADR-037; idempotency key including `block_hash`)
- SPEC §3.4 (`reorg_event` table; per-chain reorg horizons; sliding-window block-hash tracking)
- SPEC §3.8 (`abi_cache`, `selector_index`; EIP-1967, EIP-1822, OZ Transparent Proxy resolution)
- SPEC §3.11 (multi-provider failover, circuit breakers, health checks)
- SPEC §3.12 (`ingestion_dlq`, metric families: `kvorum_ingestion_*`)
- SPEC §6.20.1 (`admin_audit`)
- ADR-022 (`voting_power_block` non-NULL for v1 sources)
- ADR-025 (`api_keys` HMAC field shape)
- ADR-027 (`dao_source.backfill_started_at_block`)
- ADR-032 (`ingestion_dlq_resolved`)
- ADR-037 (defer WebSocket; polling-only for v1)

### Tasks

| ID  | Title                                                                                                        | Estimate |
| --- | ------------------------------------------------------------------------------------------------------------ | -------- |
| E1  | All schema migrations (core entities + ingestion archive + auth/audit) + Compound seed                       | ~9h      |
| E2  | Multi-provider failover RPC client + circuit breakers + health checks                                        | ~5h      |
| E3  | Polling ingestion (`eth_getLogs`) + head tracking (`eth_getBlockByNumber('latest')`) + idempotency key       | ~3h      |
| E4  | Proxy resolution (EIP-1967 + EIP-1822 + OZ Transparent) + sliding-window reorg detector + Prometheus metrics | ~5h      |

### Schema notes (E1)

- **`actor`**: minimal in M1. Fields: `id`, `primary_address` (lowercase, indexed), `display_name` (nullable; populated from ENS in M2 — NULL in M1), `bio` (nullable, NULL in M1), `profile_data` (JSONB, NULL in M1). The `actor_address` and `actor_address_redirect` tables are deferred to M2.
- **`proposal.voting_power_block`**: non-nullable per ADR-022's reading (`NULL only for sources that do not anchor voting power to a specific block — none in v1`). Compound populates from `ProposalCreated.startBlock`.
- **`proposal.state`**: enum carries the full superset (`pending|active|succeeded|defeated|queued|executed|canceled|expired|vetoed`) even though Compound never reaches `vetoed`. Storage cost is trivial; future-DAO compatibility is preserved.
- **`event_archive_compound_governor`**: header columns `id`, `dao_source_id`, `chain_id`, `block_number`, `block_hash`, `tx_hash`, `log_index`, `event_type`, `received_at`, `confirmation_status` (enum: `pending|confirmed|orphaned`), `confirmed_at` (nullable), `orphaned_at` (nullable), `orphaned_by_reorg_event_id` (nullable FK), plus `payload JSONB`. Idempotency key = unique index on `(chain_id, tx_hash, log_index, block_hash)` per SPEC §3.3.
- **`reorg_event`**: `id`, `chain_id`, `detected_at`, `divergence_block_number`, `orphaned_block_hashes text[]`, `canonical_block_hashes text[]`, `notes`.
- **`api_keys`** (per ADR-025): `id`, `user_id` (FK), `key_hash` (`bytea` — HMAC-SHA256 with global pepper, **no per-key salt**), `prefix` (text — `kv_live_` etc.), `last_four` (text), `tier` (enum: `authenticated_free`, `dashboard` reserved for M6), `label`, `created_at`, `last_used_at`, `revoked_at` (nullable). The pepper is environment-variable-sourced per ADR-028, not in the DB.
- **`admin_audit`**: `id`, `command`, `args JSONB`, `executor` (text — SSH/sudo identity), `started_at`, `completed_at`, `outcome` (`success|failure`), `error JSONB` (nullable). Append-only; no DELETE. Per SPEC §6.20.1.
- **`ingestion_dlq` / `ingestion_dlq_resolved`** (per ADR-032): same shape, plus `_resolved` carries `resolved_at`, `resolved_by`, `resolution_kind` (`accepted`|`retry_succeeded`), `reason`.
- **`dao_source.backfill_started_at_block`** (new field per ADR-027): nullable; populated when a backfill is in progress, NULL otherwise.

### Chain library notes (E2–E4)

- **Provider list shape.** `ChainConfig = { chainId, reorgHorizon, providers: [{ url, priority }] }` (HTTP only in M1 per ADR-037; WS pluggable later). Configuration via env vars; Zod-typed at startup.
- **RPC client choice.** `viem` is the recommended client (typed, modular, EIP-1967 helpers exist). Pin a specific minor version.
- **Circuit breaker.** Per-provider state machine: `closed` → `open` (after N failures in M-second window) → `half-open` (after cooldown) → `closed`. Trips on timeout, 5xx, 429.
- **Polling cadence.** 12 seconds for live event polling (matches Ethereum mainnet block time). `eth_getLogs` over a sliding window of `2 × reorg_horizon` blocks. `eth_getBlockByNumber('latest')` on the same cadence drives the reorg detector.
- **Sliding-window block-hash tracker.** In-memory ring buffer per chain, sized to `reorgHorizon + 1`. Each polled head: compare `parent_hash` to recorded entry; mismatch → reorg. The detector only emits the reorg signal (a callback); writing the `reorg_event` row is F2's responsibility.
- **Proxy resolution.** Read `eth_getStorageAt(target, IMPLEMENTATION_SLOT)` for EIP-1967; the OZ Transparent / UUPS slots have well-known constants. Recursive (proxy-of-proxy) up to 3 levels deep, hard cap.
- **Transport-pluggable interface.** `ChainClient` admits a future WebSocket implementation without consumer rework (per ADR-037's forward-compatibility commitment).

### Acceptance

- `pnpm -w db:generate && pnpm -w db:migrate:dev` succeeds end-to-end on a fresh DB
- `libs/db` exports types for every M1 entity (auto-generated by `prisma-client`)
- Compound seed runs idempotently
- Indexes documented inline in `schema.prisma` for: `proposal(dao_id, state)`, `proposal(dao_id, source_type, source_id) UNIQUE`, `event_archive_compound_governor(chain_id, tx_hash, log_index, block_hash) UNIQUE`, `event_archive_compound_governor(confirmation_status, block_number)`, `actor(primary_address) UNIQUE`
- Unit tests: provider failover happy path + on-failure fallthrough; circuit-breaker transitions; idempotency key stable across `block_hash` changes for the same logical event
- Integration test against Anvil: log retrieval via `eth_getLogs` + head polling via `eth_getBlockByNumber('latest')` + proxy resolution against a known proxied contract (e.g., USDC implementation slot)
- Metrics emitted: `kvorum_ingestion_rpc_requests_total{provider,chain,status}`, `kvorum_ingestion_rpc_failures_total`, `kvorum_ingestion_circuit_state{provider}`, `kvorum_ingestion_head_block_age_seconds{chain,source}`, `kvorum_ingestion_head_poll_lag_seconds{chain}`, `kvorum_ingestion_reorg_signals_total{chain}`
- No `apps/*` consumer yet — that's F's epic

### Risks

- **Schema drift between M1 and M2.** Tempting to over-design now (carrying M2's `vote`/`delegation`/`voting_power_snapshot` in this epic). Don't — defer until M2's epic plan, when their access patterns will inform indexes correctly.
- **Naming drift from SPEC.** Field names mirror SPEC §2.4 verbatim (e.g., `voting_power_reported` not `voting_power`). The OpenAPI surface in H echoes them; deviating costs API rework.
- **viem version churn.** viem moves fast; pin to a specific minor and revisit each milestone.
- **Proxy resolution edge cases.** Some old proxies use ad-hoc storage slots; budget time for a pluggable slot-list.
- **Polling RPC quota.** 12-second cadence × `eth_getLogs` + `eth_getBlockByNumber` is well within free-tier quotas (~14k calls/day per chain), but watch alerting at 80% utilization per SPEC §3.12.
- **Epic shape risk.** Combining schema and chain lib means E is moderately heavy. If E2–E4 stalls, E1 is already mergeable as its own PR — split mid-epic if needed.

### Open questions for negotiation

- **`users` table in M1.** ADR-036 (M0 follow-on) added `admin-cli user create / user update`, so the table likely already exists. If so, E3 only adds `api_keys` + `admin_audit`. **Action:** verify against current schema before splitting tasks.
- **`abi_cache` populated in E vs G.** Including the table now keeps G simpler. **Recommendation:** ship the table now (E2), populate on first decode in G.
- **Soft-delete for `api_keys` (`revoked_at`) vs hard-delete.** **Recommendation:** soft-delete via `revoked_at` to preserve audit.
- **viem vs ethers vs raw HTTP.** **Recommendation:** viem for its EIP-1967 helpers and TypeScript ergonomics.
- **`libs/chain` ownership of `ChainConfig` Zod schema.** **Recommendation:** `libs/chain` (domain is reserved for v1's actual entities, not infra config).

---

## Epic F — Compound Governor ingestion + reorg handling

**Estimated effort:** ~3 days
**Depends on:** E (event archive schema + chain client + reorg detector + dao_source seed)
**Gates:** G (derivation needs confirmed events), I (backfill driver consumes the same ingester)

### Purpose

Wire the chain client to the Compound Governor contract and produce confirmed archive events. This is the highest-risk M1 work: reorg correctness is verified here, the Anvil synthetic-reorg test is the gate. By the end of this epic, the indexer can be pointed at Ethereum mainnet and produce a live stream of pending → confirmed `event_archive_compound_governor` rows via 12-second polling (per ADR-037).

### Spec / ADR references

- SPEC §3.3 (EVM source ingestion: `EVMEventIngester`)
- SPEC §3.4 (reorg detection, confirmation transitions, append-only invalidation)
- SPEC §3.10 (backfill mode shares the ingester) — touched here, fully exercised in I
- SPEC §3.12 (DLQ wiring + idempotency keys)
- ADR-027 (backfill cutoff rule — partial here, full driver in I)
- ADR-032 (DLQ accept semantics — touched in I, but the table fills here)

### Tasks

| ID  | Title                                                                                                                              | Estimate |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F1  | Compound Governor source adapter (4 events) + archive writer (polling, idempotent on `(chain_id, tx_hash, log_index, block_hash)`) | ~11h     |
| F2  | Confirmation promotion sweep (every 30s) + reorg-event recording + pending → orphaned transition                                   | ~6h      |
| F3  | Anvil synthetic-reorg test (M1 acceptance gate) + DLQ wiring                                                                       | ~7h      |

### Implementation notes

- **Source location.** `apps/indexer/src/sources/compound-governor/` per SPEC §10.3's path hint. Module exposes a NestJS provider that boots one `EVMEventIngester` per `dao_source` of type `compound_governor`.
- **Compound Governor address.** Mainnet GovernorBravoDelegator: `0xc0Da02939E1441F497fd74F78cE7Decb17B66529`. ABI fragment for the four events lives in `apps/indexer/src/sources/compound-governor/abi.ts` (mirrored to the bundled ABI library in G — duplicated intentionally; F ships before G).
- **Polling-based ingestion** (per ADR-037). Every 12s, `eth_getLogs` over a sliding window writes new events to the archive as `confirmation_status = 'pending'`. Promotion is F2's sweep. Per SPEC §3.4, derived state is built only from confirmed events — G's worker never touches pending rows.
- **Promotion sweep.** Cron (NestJS `@Cron` decorator inside the indexer process; no separate scheduler service for M1) runs every 30s. Set-based `UPDATE ... WHERE confirmation_status = 'pending' AND block_number <= $head − $reorgHorizon`.
- **Reorg flow.** On detector callback (driven by polled `eth_getBlockByNumber('latest')` from E4): write `reorg_event` row inside a transaction that also `UPDATE event_archive_compound_governor SET confirmation_status = 'orphaned', orphaned_at = now(), orphaned_by_reorg_event_id = $new_id WHERE block_hash = ANY($orphaned_hashes) AND confirmation_status = 'pending'`. The data fields are not modified.
- **Anvil reorg test.** Use Foundry's Anvil with `--fork-url` against a recent mainnet block. Inject a synthetic reorg via `anvil_setNextBlockBaseFeePerGas` + chain manipulation, or via the simpler `anvil_reset` + replay-with-different-tx pattern. The indexer's polling loop detects the reorg on the next 12s tick. Assert per SPEC §3.4 list (orphaned status, reorg_event row, no derived state mutated).
- **DLQ wiring.** Failed normalization (malformed event payload, FK violation against `dao_source`) lands in `ingestion_dlq` with `stage = 'archive_write'` after retry budget exhaustion (3 attempts, exponential backoff via BullMQ).

### Acceptance

- Pointed at Ethereum mainnet via free-tier RPC, the indexer produces `event_archive_compound_governor` rows for live `ProposalCreated` / `ProposalQueued` / `ProposalExecuted` / `ProposalCanceled` events within ~12s of block confirmation
- Promotion sweep transitions events to `confirmed` after `reorgHorizon` confirmations (12 blocks ≈ 2.5 min on mainnet)
- Anvil synthetic-reorg test passes per SPEC §3.4 (5 assertions)
- DLQ accumulates one entry under deliberate fault injection; `kvorum_dlq_size{stage="archive_write"}` reflects it
- `kvorum_ingestion_pending_event_count{chain_id="1",source_type="compound_governor"}` exposes pending depth

### Risks

- **Reorg horizon edge cases.** A reorg deeper than the configured horizon (12 on mainnet) is an alerting condition (SPEC §6.20.2 alert) but does not corrupt data — orphaned events stay orphaned in the archive, derivation isn't affected (only confirmed events project). Documented; no special code path.
- **Idempotency on `block_hash`.** The unique index includes `block_hash` so the same logical event under two different block hashes (during a reorg) creates two distinct rows. This is intentional per SPEC §3.3 and must be checked in unit tests — easy to mis-implement as `(chain_id, tx_hash, log_index)` and silently lose reorg history.
- **Anvil reorg fixture stability.** Anvil's reorg primitives have changed across Foundry versions. Pin the Foundry version in the test runner; document the exact incantation. Budget half a day for fixture authoring alone.
- **Polling-window sizing.** The `eth_getLogs` sliding window must be ≥ `2 × reorg_horizon` to guarantee no events are missed across a poll cycle. Smaller windows risk gaps; larger windows waste RPC quota. Document the calculation; revisit if `eth_getLogs` page limits force a smaller window.

### Open questions for negotiation

- **Promotion sweep in `apps/indexer` or `apps/scheduler`?** Per cross-cutting note above, M0 deferred a separate scheduler service. **Recommendation:** indexer-resident for M1; revisit if cross-process contention shows up.
- **Reorg horizon override per source?** SPEC §3.4 specifies per-chain horizons; configurable per-source seems unnecessary for M1. **Recommendation:** chain-level only.
- **Etherscan-fed state-transition fallback?** **Recommendation:** no — the polling fallback's window must be wide enough to cover WS dropouts. If we observe gaps, file an ADR.

---

## Epic G — Derivation + ABI decoding

**Estimated effort:** ~2.5 days
**Depends on:** E (proposal/proposal_action/proposal_choice/abi_cache schema), F (confirmed events to project)
**Gates:** H (proposal endpoints need real data)

### Purpose

Project confirmed `event_archive_compound_governor` rows into the unified core entities (`proposal`, `proposal_action`, `proposal_choice`). Implement the per-source title extraction (ADR-030 Compound rule). Land the local-first ABI decoding pipeline that hits the M1 acceptance criterion of >95% decoded calldata.

### Spec / ADR references

- SPEC §2.4.4 (proposal essential fields)
- SPEC §2.4.5 (proposal_action shape, decoded fields nullable until resolved)
- SPEC §2.4.6 (proposal_choice — Compound: For/Against/Abstain)
- SPEC §3.4 (derivation only consumes confirmed events)
- SPEC §3.8 (ABI decoding pipeline: bundled selector index, bundled ABI library, proxy resolution, heuristic decoders, optional Etherscan)
- ADR-022 (`voting_power_block` populated for Compound from `startBlock`)
- ADR-030 (title extraction — Compound rule)

### Tasks

| ID  | Title                                                                                                                                                                                                                                                   | Estimate |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | Derivation worker (poll every 5s, set-based) projecting confirmed events → proposal/action/choice rows; title extractor (ADR-030) in `libs/domain`                                                                                                      | ~6h      |
| G2  | Full ABI decoding pipeline: bundled selector index (4byte snapshot) + bundled ABI library + `abi_cache` population + heuristic decoders + proxy resolution (calls E4) + 24h re-enqueue retry path + optional Etherscan enrichment behind a feature flag | ~12h     |

### Implementation notes

- **Derivation trigger.** Postgres `LISTEN/NOTIFY` is the spec-flavored answer (SPEC §3.4: "the derivation layer subscribes to confirmation transitions via Postgres LISTEN/NOTIFY or polling"). NOTIFY requires raw SQL — that's an explicit allowed exception per CLAUDE.md's ORM-first policy. **Recommendation:** start with polling (every 5s, set-based query); promote to NOTIFY in M2 if latency is felt. Polling keeps the derivation worker simple and ORM-first.
- **Idempotency.** Derivation is set-based: `INSERT ... ON CONFLICT (dao_id, source_type, source_id) DO UPDATE` for proposal upserts, with a state-transition guard so we don't regress (e.g., `executed` doesn't go back to `queued`). Re-running the derivation against the same archive row produces the same proposal row.
- **Compound proposal_choice rows.** Three rows always: `(0, 'Against'), (1, 'For'), (2, 'Abstain')` — note Compound's actual ordinal mapping; verify against `castVote`'s support enum at implementation time.
- **Title extractor.** `libs/domain/src/title-extractor.ts` exports a per-source-type function. Compound rule (ADR-030): first non-empty line of `description`, strip leading `#` chars + whitespace, truncate to 200 chars with `…` (U+2026) if longer, NULL if description is empty. Tests: typical proposal, empty description, leading `#`, very long line.
- **Bundled selector index.** `libs/chain/abi/4byte-snapshot.json` — a versioned snapshot of 4byte.directory's public dataset (committed to repo, refreshed by an out-of-band weekly maintenance job documented but not automated in M1). Loaded at indexer startup into an in-memory map.
- **Bundled ABI library.** `libs/chain/abi/library/` JSON files for: ERC20, ERC721, ERC1155, OZ AccessControl, OZ Governor (Compound's Governor Bravo specifically), Compound's Comptroller, common COMP/Uniswap/Curve targets. M1 ships the minimum needed for >95% of historical Compound proposals — the long tail is fine.
- **Heuristic decoders.** Built-in handlers for `transfer(address,uint256)`, `approve(address,uint256)`, `grantRole(bytes32,address)`, `setImplementation(address)`, `_setPendingAdmin(address)`, `_acceptAdmin()`. These bypass the ABI library and produce structured output directly.
- **Etherscan enrichment.** Slow-path background job, feature-flagged via env var (`ETHERSCAN_ENRICHMENT_ENABLED=false` by default). When enabled, free-tier API key sourced via ADR-028 vault. Failures degrade silently. Successfully retrieved ABIs land in `abi_cache`.
- **24h retry.** Failed decodes (no library hit, no proxy resolution, no heuristic match) re-enqueue the decode job with a 24h delay so contracts that get verified post-proposal are eventually decoded.

### Acceptance

- Derivation worker produces a `proposal` row + N `proposal_action` rows + 3 `proposal_choice` rows for every confirmed `ProposalCreated` event
- State transitions (`ProposalQueued` → `state = 'queued'`, `ProposalExecuted` → `state = 'executed'`, `ProposalCanceled` → `state = 'canceled'`) update the `proposal` row idempotently
- Title extraction matches ADR-030 fixtures (3+ test cases)
- After ingesting a sample of 30 historical Compound proposals, ≥95% have `decoded_function != NULL` (the M1 acceptance criterion at fixture scale)
- `kvorum_derivation_lag_seconds` and `kvorum_derivation_abi_decode_success_rate` exposed
- Etherscan enrichment is off by default; flipping the flag does not crash (validated end-to-end)

### Risks

- **Bundled ABI library coverage.** The 95% figure depends on which contracts historical Compound proposals targeted. If actual coverage at fixture-scale is below 95%, options: expand the library, lean harder on heuristics, or enable Etherscan enrichment by default (with a documented rate-limit envelope). Validate empirically during G2.
- **State machine ordering.** Out-of-order event arrival (e.g., `ProposalExecuted` confirmed before `ProposalQueued` due to retry timing) must not corrupt state. The state transition guard in derivation handles this; tests must cover it.
- **Description content.** Compound proposals occasionally embed binary or weird unicode in descriptions; title extractor must not crash on these. Fuzz-test where possible.

### Open questions for negotiation

- **NOTIFY vs poll for derivation trigger.** **Recommendation:** poll in M1 (simpler, ORM-first, sufficient at v1 scale). NOTIFY is an M2 optimization if measured latency exceeds budget.
- **Bundled selector index refresh cadence.** SPEC §3.8 says weekly. **Recommendation:** ship the snapshot in M1, document the refresh process in `docs/runbooks/`, automate the cron in M7.
- **Optional Etherscan enrichment as default-on?** **Recommendation:** off by default; flip on if G2's empirical coverage is below 95%.

---

## Epic H — API surface (auth, rate limit, errors, endpoints, OpenAPI)

**Estimated effort:** ~4.5 days (foundations ~2.5d + endpoints + OpenAPI ~2d)
**Depends on:** E (api_keys schema), Redis (already in compose from M0); G provides real data for the conformance test
**Gates:** acceptance criteria #5 (response shape), #6 (p95 < 500ms)

### Purpose

The full API for M1 in one epic. Foundations and endpoints ship together because they're written in the same PR-stack — auth+rate-limit+error-model are the primitives that the controller code uses, and the conformance test (H6) only makes sense once both halves exist. By the end of this epic, `apps/api` is production-shaped and the proposal endpoints are live.

The two logical sub-bodies of work, in execution order:

- **API foundations (H1–H4)** — every cross-cutting concern: auth, rate limiting, error model, pagination, ETag, structured logging, Prometheus metrics. Doing this once in M1 means M2/M3/M4 endpoints inherit the right primitives.
- **Endpoints + OpenAPI (H5–H6)** — the six endpoints from SPEC §4.6.1 (DAOs, proposal list/detail, cross-DAO list), `@nestjs/swagger`-generated OpenAPI at `/v1/openapi.json` + `/v1/docs`, and the response-shape conformance + p95 latency validation.

### Spec / ADR references

- SPEC §4.2 (URL identifiers: `(dao_slug, source_type, source_id)`)
- SPEC §4.3 (auth: Bearer header, key format `kv_live_<32 url-safe>`, key lifecycle)
- SPEC §4.4 (rate limits: 60 RPM / 10000 daily for `authenticated_free`; IETF headers; 429 + Retry-After)
- SPEC §4.5 (cursor-based pagination, default/max page size, filter strict-parsing, sort + `-` reverse)
- SPEC §4.6.1 (entity resource catalog: DAOs, Proposals, Actors-minimum)
- SPEC §4.7 (response shape: `data`, `_meta`, `_meta.links`, lowercase addresses, big numbers as strings, ISO 8601 UTC)
- SPEC §4.8 (RFC 7807 problem+json, status code conventions, validation `violations` array)
- SPEC §4.9 (Cache-Control + ETag + If-None-Match → 304)
- SPEC §4.10 (OpenAPI generation, served at `/v1/openapi.json` + `/v1/docs`)
- SPEC §6.20.2 (metric families)
- SPEC §7.2 (latency targets: p50 < 100ms, p95 < 500ms, p99 < 1500ms for entity GETs)
- SPEC §7.4 (structured logging required fields)
- ADR-025 (HMAC-SHA256 for API keys; constant-time compare; pepper from env)

### Tasks

| ID  | Title                                                                                                                                                                                                                                       | Estimate |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| H1  | API key auth middleware: Bearer header, HMAC-SHA256 (pepper from env), `crypto.timingSafeEqual` compare, 401 on missing/invalid                                                                                                             | ~4h      |
| H2  | Rate limiting middleware: Redis-backed sliding-window counter per tier, IETF headers, 429 + Retry-After, fall-open on Redis down per SPEC §7.3                                                                                              | ~5h      |
| H3  | Error model (RFC 7807 problem+json filter) + cursor pagination + filter/sort parser (strict, opaque cursor)                                                                                                                                 | ~5h      |
| H4  | ETag/Cache-Control middleware (per-endpoint TTL, conditional GET → 304) + Prometheus `/metrics` endpoint + structured request logging with request_id                                                                                       | ~4h      |
| H5  | All proposal + DAO endpoints: `GET /v1/daos`, `GET /v1/daos/{slug}`, `GET /v1/daos/{slug}/sources`, per-DAO proposal list (filter/sort/pagination/ETag), per-DAO proposal detail (actions, choices, `_meta`), cross-DAO `GET /v1/proposals` | ~10h     |
| H6  | `@nestjs/swagger` OpenAPI generator at `/v1/openapi.json` + Swagger UI at `/v1/docs`; commit `docs/openapi.json`; response-shape conformance test (per §4.7 fixtures) + p95 < 500ms warm-cache validation (k6 or autocannon)                | ~6h      |

### Implementation notes — foundations (H1–H4)

- **Auth middleware.** NestJS `Guard` reads `Authorization: Bearer kv_live_...`, splits prefix, computes `HMAC-SHA256(pepper, key)`, queries `api_keys` by hash + `revoked_at IS NULL`, attaches `request.user` + `request.apiKey` to the request. Pepper rotation grace window per ADR-025: read `HMAC_PEPPER_CURRENT` and `HMAC_PEPPER_PREVIOUS` env vars; verify against either; log which one matched (for rotation observability).
- **Rate limit data structure.** Per-key sliding window in Redis: `INCR` + `EXPIRE` on a key like `rl:apikey:{id}:minute:{floor_minute}`; window cleanup is implicit via TTL. Daily counter is a separate key. Per SPEC §4.4 the per-IP rate limit on auth endpoints is reserved for M6 (developer dashboard); M1 only exposes API endpoints, so per-IP limiting is implemented but not yet routed.
- **Error model.** Global exception filter mapping NestJS `HttpException` and Zod validation errors to RFC 7807 shape. `Content-Type: application/problem+json`. The `type` URI uses a placeholder host (`https://kvorum.example/errors/`) — production swap is M7's concern.
- **Cursor design.** Base64-encoded JSON with `{ type: 'time', value: <iso>, dir: 'asc'|'desc', filter_hash: <sha1> }`. The `filter_hash` is the SHA-1 of the original request's filter+sort params; on next-page request, recompute and compare → 400 if mismatch (SPEC §4.5: "passing a cursor with conflicting query parameters returns 400 Bad Request").
- **Filter/sort parser.** Per-endpoint allowlist of filter fields and sortable fields. Unknown filter → 400 with violations array. Sort on a non-indexed field → 400. Implementation: a small Zod schema per endpoint, fed into a generic Prisma where-clause builder.
- **ETag.** Per-endpoint TTL + ETag generation. For entity GETs, ETag is the SHA-1 of the response payload (cheap; resources are small). For list GETs, ETag includes the highest `state_updated_at` and the row count of the page (changes invalidate). `If-None-Match` with a matching ETag → 304 with no body.
- **Metrics.** `/metrics` exposed on a separate port (default 9090) so Prometheus scraping doesn't compete with public traffic. `kvorum_api_requests_total{method,route,status}`, `kvorum_api_latency_seconds{...}` histogram, `kvorum_rate_limit_rejections_total{tier}`.
- **Logging.** Pino-based structured JSON logger; request_id via `cls-rtracer` or NestJS's built-in async-local-storage. Required fields per SPEC §7.4.

### Implementation notes — endpoints (H5–H6)

- **`_meta.confirmed`.** Always `true` in M1 per SPEC §3.4 forward-compat commitment. The field is included in responses regardless — clients that branch on it gain pending support automatically when v1.1 turns it on.
- **`_meta.links`.** Hyperlinks per §4.7: `self`, `votes` (will 404 in M1 since votes ship in M2; the link is included anyway), `forum` (ships in M4; not included until then). **Negotiation:** include placeholder `votes` link in M1, or omit until M2 ships? **Recommendation:** include — clients that follow the link get a 404 with a clear "votes ship in M2" problem detail; graceful.
- **Filter shape (`/v1/daos/{slug}/proposals`).** From SPEC §4.6.1: `state` (multi-value comma-separated), `source_type`, `proposer` (address), `binding` (boolean), `voting_starts_at_min`, `voting_starts_at_max`. Sortable: `voting_starts_at`, `voting_ends_at`, `created_at`, `state_updated_at`. Unknown filter → 400.
- **OpenAPI generation.** `@nestjs/swagger` reads NestJS controller decorators and DTO classes. The DTO classes live alongside the controllers; no separate type definition. The committed `docs/openapi.json` is regenerated by a release script — automated per M7, manual for M1.
- **Big-number serialization.** Response DTO marks `voting_power_block`, `tally.for/against/abstain` as strings. The serializer (a NestJS interceptor) converts BigInt → string; addresses → lowercase string.
- **Cross-DAO endpoint.** `GET /v1/proposals?dao=compound,aave` — in M1 only `compound` returns rows; the multi-value filter validates per SPEC §4.6.1.

### Acceptance

- A request with no `Authorization` header → 401 with problem+json body
- A request with an invalid bearer key → 401 (response shape stable)
- A valid key gets `RateLimit-*` headers; 60th request in a minute is 429 with `Retry-After`
- Cursor pagination round-trips: page 1 → page 2 cursor decoded → page 2 with no overlap; conflicting filter on page 2 → 400 with violations
- Conditional GET with `If-None-Match` returns 304 Not Modified, no body
- `/metrics` endpoint serves Prometheus format on the metrics port
- Structured JSON logs include `request_id`, `timestamp`, `level`, `service`, `message`
- All six endpoints return responses matching SPEC §4.7 shape (validated by a snapshot/conformance test against a fixed fixture set)
- ETag / 304 round-trip works on `GET /v1/daos/{slug}/proposals/{source_type}/{source_id}`
- `GET /v1/openapi.json` returns a valid OpenAPI 3.1 document; Swagger UI loads
- p95 < 500ms on warm cache for proposal detail (validated with k6/autocannon against ~300 indexed proposals; load test scripted in `infra/load-tests/m1-proposals.js`)
- `docs/openapi.json` committed and matches the served spec at the M1 release tag

### Risks

- **Pepper rotation in test environments.** The grace window logic must be tested with both peppers set and only one set; easy to write code that crashes when `HMAC_PEPPER_PREVIOUS` is undefined.
- **Cursor opacity.** Don't leak cursor format to clients via error messages — base64-decode failures should produce a generic "invalid cursor" 400, not a JSON parse error.
- **ETag generation cost.** SHA-1 of large list payloads is fine at v1 scale (response sizes < 100KB), but watch the histogram; if list-page p95 latency degrades, revisit (e.g., use a content-version column instead of payload hash).
- **Redis fall-open semantics.** SPEC §7.3 says "rate limiting falls open" on Redis down. This is the right call but counter-intuitive — document explicitly in the middleware and validate with an injected fault test.
- **`@nestjs/swagger` + DTO ergonomics.** Generating accurate schemas from TS types requires either DTO classes with decorators or `@ApiProperty` on every field. Budget time for the verbosity.
- **Latency target requires indexes.** The proposal list query with `state` filter + sort by `voting_starts_at` needs the right composite index (`(dao_id, state, voting_starts_at DESC)`). E1's index list must include it; if it doesn't, adjust during H5.
- **Response shape drift.** SPEC §4.7's example is the contract — deviating (e.g., omitting `_meta.confirmed`, returning numbers instead of strings) is a long-term API break. The conformance test in H6 is the gate.
- **Epic shape risk.** H is the heaviest epic (~4.5d). Foundations (H1–H4) are mergeable as their own PR before endpoints land — split mid-epic if review surfaces grow too large.

### Open questions for negotiation

- **Rate limit data structure: sliding window vs token bucket?** **Recommendation:** sliding window via Redis script (more accurate IETF headers).
- **Per-IP rate limiting in M1.** **Recommendation:** implement the primitive but don't route it yet (M6 needs it for auth-creation endpoints).
- **Error type URIs: stable host now or M7?** **Recommendation:** placeholder `kvorum.example` host now; M7 swaps to the real domain.
- **`_meta.links.votes` in M1 even though the endpoint 404s?** **Recommendation:** include — graceful failure.
- **`/v1/openapi.json` vs `/openapi.json` (no version prefix).** **Recommendation:** version-prefixed to match SPEC §4.10.
- **Load-test target: production-shape Postgres or test DB?** **Recommendation:** test DB seeded with the ~300 backfilled proposals from I3. Same shape, no upstream dependency.

---

## Epic I — Backfill orchestration + admin CLI wiring

**Estimated effort:** ~2 days
**Depends on:** E, F, H (api_keys table + auth middleware ready for the keys-create command)
**Gates:** acceptance criterion #1 (~300 historical Compound proposals indexed)

### Purpose

Replace the M0 `admin-cli` stubs with real implementations for the M1-scope commands, and run the historical Compound backfill end-to-end. Per ADR-027, backfill writes events with `confirmation_status` determined per-event by the cutoff `chain_head_at_backfill_start − reorg_horizon[chain]`, captured once at backfill start.

### Spec / ADR references

- SPEC §3.10 (backfill strategy, chunked `eth_getLogs`, resumability, idempotency)
- SPEC §6.20.1 (admin CLI surface; safety affordances; audit log; output discipline)
- ADR-027 (backfill confirmation cutoff rule + `dao_source.backfill_started_at_block`)
- ADR-032 (`dlq accept` permanent acknowledgement; `ingestion_dlq_resolved` archive)

### Tasks

| ID  | Title                                                                                                                                                                                                                                                                                              | Estimate |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| I1  | Backfill driver per ADR-027: chunked `eth_getLogs` (10k blocks default, adaptive shrink); resumable via `dao_source.backfill_head_block` + `backfill_started_at_block`; per-event cutoff classification                                                                                            | ~5h      |
| I2  | Wire all M1-scope `admin-cli` commands: `backfill {start,status,cancel}`, `dao {add, source add, source update}`, `derive {replay, verify}`, `dlq {list, retry, accept}` (ADR-032 semantics), `reorg list`, `status`, `keys {create, list, revoke}` (M1 mint path) — all with `admin_audit` writes | ~10h     |
| I3  | Run historical Compound backfill (~300 proposals); validate acceptance criteria #1 + #4 (>95% calldata decoded) end-to-end                                                                                                                                                                         | ~3h      |

### Implementation notes

- **Backfill driver shape.** Reuses the same `EVMEventIngester` from F, configured with `(fromBlock, toBlock)` and a `cutoffBlock = chainHeadAtStart − reorgHorizon`. Chunk loop iterates `[fromBlock, toBlock]` in 10k-block windows; each event in a chunk is classified per ADR-027:
  ```
  confirmation_status = event.block_number <= cutoffBlock ? 'confirmed' : 'pending'
  ```
- **Resumability.** Before each chunk, `UPDATE dao_source SET backfill_head_block = $chunk_end`. On crash, restart reads `backfill_head_block` and `backfill_started_at_block` (the rehydrated cutoff). Operator-triggered fresh restart clears both fields.
- **Adaptive shrinking.** On `eth_getLogs` rejecting a 10k window (typical "too many results" RPC error), halve the window, retry. Backoff floor 1k blocks; below that, surface the problem.
- **`admin-cli keys create`.** SPEC §4.3 says the dashboard mints keys; M1 has no dashboard, so this command is the M1 equivalent. Output is the plaintext key (shown once, never persisted) on stdout. Hashed via the same HMAC pepper used by H1's auth middleware.
- **`admin-cli status`.** Reads metrics from the API and indexer's `/metrics` endpoints (or directly from Postgres for ingestion lag, DLQ size, recent reorg count). Output: human-readable table by default, JSON via `--format json`.
- **`admin_audit`.** Every mutating CLI command writes a row before and after execution. Started/completed timestamps + outcome capture failures.
- **DLQ commands.** `dlq list`: select from `ingestion_dlq` with optional `--feature`/`--limit`. `dlq retry`: re-enqueues for the original stage's worker. `dlq accept`: per ADR-032, moves to `ingestion_dlq_resolved` with `resolution_kind = 'accepted'`, `--reason` required (rejected if empty/whitespace).

### Acceptance

- `admin-cli backfill start <compound_dao_source_id>` completes for the historical Compound range, populating `event_archive_compound_governor` with classifier-correct `confirmation_status`
- ~300 historical Compound binding proposals visible via `GET /v1/daos/compound/proposals?state=executed,defeated,canceled,expired&limit=200` (paginated)
- ≥95% have `decoded_function != NULL` (re-validates G's empirical fixture-scale claim at production-scale)
- `admin-cli dlq list` shows fixture entries from F's fault injection; `dlq accept --reason "test"` moves them
- `admin-cli status` returns sane values (head block age, DLQ size, recent reorg count)
- Every M1-scope mutating command writes an `admin_audit` row
- An operator can mint a working API key via `admin-cli keys create` and curl the proposal endpoints with it

### Risks

- **RPC quota during backfill.** ~300 proposals over Compound's 4-year history is fine; the bigger consumer is `eth_getLogs` over the full block range. Free-tier providers should handle it; budget for one provider exhausting and failover kicking in.
- **Backfill / live overlap.** When backfill catches up to within `reorg_horizon` of head, live ingestion is already running. Idempotency on `(chain_id, tx_hash, log_index, block_hash)` makes this a no-op write; tested in F's idempotency unit tests but worth a deliberate end-to-end check during I3.
- **`admin_audit` write contention.** Fine at v1 scale; mention only because it's an unindexed-write bottleneck in larger systems. Indexed on `(executor, started_at)` for query.
- **Operator identity capture.** SSH/sudo context per SPEC §6.20.1 — `process.env.SUDO_USER || process.env.USER || 'unknown'`. Documented limitations: containerized runs lose the SSH context; M1 accepts this with a fallback; M7 may revisit.

### Open questions for negotiation

- **Should `admin-cli keys create` be M1 or deferred to M2?** M1 needs _some_ way to mint a key for testing; **recommendation:** M1, minimum surface (`create`, `list`, `revoke`).
- **Backfill kickoff: manual via `admin-cli` or auto on `dao source add`?** **Recommendation:** manual — auto-start is too magical for v1.
- **`admin-cli status` output.** **Recommendation:** human by default, JSON via `--format json` per SPEC §6.20.1.
- **Run the I3 backfill against mainnet directly, or against a forked Anvil with a frozen block?** **Recommendation:** mainnet via free-tier RPC — read-only; the data is what we want indexed. Frozen-Anvil is a fallback if mainnet quota runs out.

---

## What M2 inherits from M1 (forward-link)

M2 (Compound votes & voting power) adds onto M1's foundation:

- **`vote` + `vote_choice` + `delegation` + `voting_power_snapshot` schema** — M2's first epic
- **`actor_address` + `actor_address_redirect` (ADR-033)** — M2 introduces actor merging; the redirect routing in the API is added to Epic H's primitives
- **Voting-power snapshot job** — new derivation worker job, uses M1's chain client for `getPriorVotes` verification
- **ENS resolution** — populates `actor.display_name`, cached, periodic refresh
- **Vote endpoints** — `GET /v1/daos/{slug}/proposals/{source_type}/{source_id}/votes` (already a 404 link in M1's `_meta`), `GET /v1/actors/{address}/votes`
- **Analytical endpoints (concentration, alignment)** — first cut against Compound only
- **ClickHouse analytical mirror layer** — _deferred per ADR-038_ (ADR-026's analytical-mirror activation triggers preserved); M2 holds analytical queries on Postgres for v1. The **archive layer** is already live from M1.
- **Cross-DB reconciliation job (ADR-041)** — periodic CH-orphan / PG-orphan sweep; closes the small inconsistency window M1 accepts
- **ADR-021 (vote supersession), ADR-023 (`primary_choice` scope)** — M2 territory

M1's contract for M2:

- `proposal` rows exist with stable `(dao_id, source_type, source_id)` keys
- `actor` rows exist for proposers; M2 expands actor population to voters and delegates
- The chain client's WS + polling + reorg machinery handles `VoteCast` / `DelegateVotesChanged` events with no library changes (just new event signatures)
- The API auth + rate limit + error model + ETag primitives extend to vote endpoints with no rework

---

## Definition of done for M1

- All 5 epics merged to `main`
- All M1 acceptance criteria (1–6) verified end-to-end via the backfill in I3 + the Anvil reorg test in F3
- `docs/openapi.json` committed at the M1 release tag
- `docs/metrics.md` enumerates every metric family emitted by M1 services
- `docs/runbooks/secrets-rotation.md` updated with the HMAC pepper rotation procedure (ADR-025 ⨯ ADR-028)
- Pre-commit checks (`pnpm -w format:check && pnpm -w lint && pnpm -w typecheck && pnpm -w test`) green on `main`
- Each ADR referenced above is updated to `Accepted` if its M1 application is the first concrete implementation (ADR-025, ADR-027, ADR-030, ADR-032 likely flip from Proposed → Accepted after merge; ADR-022 partial — Compound side only)
- A short M1 retro doc (`docs/retro-m1.md`) — what shifted, what's deferred to M2, any new ADRs surfaced during execution

---

## Approval gate

Per repo convention (plans land as `docs/*.md` and wait for explicit go-ahead before implementation):

- **No GitHub issues will be created** until the breakdown is locked.
- After approval, expand each task into a GitHub issue under the `M1 — Compound proposals end-to-end` milestone, mirroring the M0 epic-issue format (Purpose / Spec references / Issues table / Dependency graph / Acceptance / Risks / Definition of done).

Reply with go / no-go on the breakdown, or comment inline with adjustments. The most useful negotiation surfaces are flagged in each epic's "Open questions for negotiation" section.
