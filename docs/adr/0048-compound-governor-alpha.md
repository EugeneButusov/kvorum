# ADR-048 — Index Compound Governor Alpha as `compound_governor_alpha`

**Status:** Accepted  
**Date:** 2026-05-17

---

## Context

Compound DAO has governed on-chain through two successive contracts:

| Contract       | Address                                      | Deploy block | Proposals     |
| -------------- | -------------------------------------------- | ------------ | ------------- |
| Governor Alpha | `0xc0dA01a04C3f3E0be433606045bB7017A7323E38` | 9601459      | 1 – ~64       |
| Governor Bravo | `0xc0Da02939E1441F497fd74F78cE7Decb17B66529` | 12006099     | ~65 – present |

M1 acceptance validation found 351 derived proposals against 539 on Tally — a gap of ~188 proposals that maps exactly to the Alpha contract not being indexed.

Governor Alpha's contract-creation block is **9601459** (Ethereum mainnet, 2020-02-24), verified via Etherscan creation tx `0x817209a08caec3e9193afd48ba7a7a1ea5ccb3f8a9494446bfb0b43213efe81f` (creator "Compound: Deployer 3", `0xcec237e83a080f3225ab1562605ee6dedf5644cc`). This mirrors the provenance style of `compound_003_active_from_block.ts` for the Bravo block.

### Event ABI parity (full)

The existing Bravo plugin's log filter subscribes to **all four** topics in `COMPOUND_EVENT_TOPICS` (`libs/sources/compound/src/governor/events.ts`), not just `ProposalCreated`. When the filter is reused for Alpha, Alpha's emissions of all four events are ingested and decoded by the shared decoder. Parity must therefore be established for every event the filter subscribes to, not only `ProposalCreated`. Topic-0 hashes below were computed from the normalized canonical signatures (`uint`→`uint256`) and cross-checked against `compound-finance/compound-protocol` (`GovernorAlpha.sol`, `GovernorBravoInterfaces.sol`) and the verified Etherscan source.

| Event              | Canonical signature                                                                                           | topic-0 (Alpha = Bravo?) | Verdict                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------ |
| `ProposalCreated`  | `ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)` (no `indexed`) | identical                | **Shared decoder safe** — verified   |
| `ProposalQueued`   | `ProposalQueued(uint256,uint256)`                                                                             | identical                | **Shared decoder safe**              |
| `ProposalExecuted` | `ProposalExecuted(uint256)`                                                                                   | identical                | **Shared decoder safe**              |
| `ProposalCanceled` | `ProposalCanceled(uint256)`                                                                                   | identical                | **Shared decoder safe**              |
| `VoteCast`         | Alpha `VoteCast(address,uint256,bool,uint256)` vs Bravo `VoteCast(address,uint256,uint8,uint256,string)`      | divergent                | **Out of M1 scope — deferred to M2** |

`ProposalCreated` parity was confirmed independently: both contracts declare it with byte-identical parameter lists and **no `indexed` modifiers**, so both topic-0 and data layout match — `COMPOUND_GOVERNOR_INTERFACE.parseLog` decodes Alpha logs unchanged. The three lifecycle events are likewise byte-identical, so the shared decoder and projector handle Alpha lifecycle logs with zero code change. Only `VoteCast` diverges (Alpha uses `bool support` and carries no `reason`), and `VoteCast` is out of M1 scope.

---

## Decision

Add `compound_governor_alpha` as a second source type that re-uses all M1 Bravo primitives (decoder, archive writer, ingester listener, projection applier). `createCompoundGovernorPlugin` is refactored to delegate to an internal factory parameterized by `sourceType`; a thin `createCompoundGovernorAlphaPlugin` sets `sourceType: 'compound_governor_alpha'`. Everything else is shared.

Both composition roots that construct a Compound plugin must be updated, not only the indexer:

- **`apps/indexer`** (`IndexerModule`) — DI registers both plugins into `SOURCE_PLUGINS`; the orchestrator already routes logs by `sourceType` string, so no orchestrator change is needed.
- **`apps/admin-cli`** (`backfill start <source_type>`) — this is a **separate composition root** that today hardcodes both the guard `if (row.source_type !== 'compound_governor')` and the plugin constructor `createCompoundGovernorPlugin(...)` (`apps/admin-cli/src/commands/backfill.ts:57,84`). It must be generalized to accept `compound_governor_alpha` and select the matching plugin by `source_type`. Without this the ADR's prescribed backfill command fails with `ValidationFailure`.

---

## Options considered

**A — Multi-address filter on existing `compound_governor`**  
Extend `source_config` from `{governor_address: string}` to `{governor_addresses: string[]}` and index both contracts under one source type.  
Rejected: conflates two distinct governance eras; complicates M2 where `VoteCast` ABIs differ; requires config-schema migration on the live `dao_source` row. Note: this option _would_ have kept Compound's continuous proposal-id space under a single `source_type`, avoiding the read-model split described in Consequences. That tradeoff is real but is outweighed by the M2 `VoteCast` divergence and the live config-schema migration risk.

**B — New source type, shared implementation (chosen)**  
New `compound_governor_alpha` source type, separate `dao_source` row, thin plugin wrapper delegating to a shared internal factory.  
Clean per-source _address_ filtering, no duplication for M1, natural extension point when M2 needs separate `VoteCast` handling. Accepted cost: the derived read model partitions Compound's single continuous proposal-id space by `source_type` (see Consequences).

**C — New source type, fully duplicated code**  
Unnecessary; `ProposalCreated` and all three lifecycle events are ABI-compatible so there is nothing to diverge for M1.

---

## Consequences

### Migration

- New `compound_governor_alpha` value inserted into `source_type` reference table, and a new `dao_source` row (compound DAO, `source_config = {"governor_address": "0xc0dA01a04C3f3E0be433606045bB7017A7323E38"}`, `active_from_block = 9601459`) — migration `compound_004_governor_alpha.ts`, following the `compound_001`/`compound_002`/`compound_003` patterns. Add `export const GOVERNOR_ALPHA_DEPLOY_BLOCK = 9601459;` with the creation-tx provenance comment, mirroring `GOVERNOR_BRAVO_DEPLOY_BLOCK`. The `dao_source` unique constraint is `(dao_id, source_type)`, so a second Compound row under a distinct `source_type` is permitted.

### Code

- `createCompoundGovernorAlphaPlugin` added to `libs/sources/compound`; `createCompoundGovernorPlugin` refactored to share an internal `sourceType`-parameterized factory. The Zod `source_config` schema and the decoder are unchanged (shared).
- `CompoundSourceModule` (`nest/sources/compound`) exposes a `COMPOUND_ALPHA_PLUGIN` token alongside `COMPOUND_PLUGIN`.
- `IndexerModule` (`apps/indexer`) injects both plugins into `SOURCE_PLUGINS`.
- **`apps/admin-cli` backfill command must be generalized** (`backfill.ts:57,84`): replace the hardcoded `compound_governor` guard and plugin constructor with selection by `row.source_type` (e.g. a small `{ compound_governor, compound_governor_alpha }` plugin map keyed by source type). This is a required code change, not optional — the ADR's backfill step depends on it.

### Data correctness (archive, confirmation, projection)

- **Archive (ClickHouse) — safe.** `event_archive_compound_governor` is `ReplacingMergeTree(received_at)` ordered by `(chain_id, block_number, tx_hash, log_index, block_hash)`; it has no `source_type` column. Alpha and Bravo are distinct on-chain addresses, so identical-coordinate logs across the two contracts are physically impossible — no cross-source dedup collision.
- **Confirmation (Postgres) — safe.** The `archive_confirmation` idempotency and canonical uniqueness keys both lead with `source_type`, so Alpha and Bravo confirmations occupy distinct key spaces.
- **Projection — no corruption, but a semantic split.** The derived `proposal` natural key is `(dao_id, source_type, source_id)`. Compound's proposal-id counter is _continuous_ across the two contracts (Alpha 1–~64, Bravo ~65–present), but indexing Alpha under a distinct `source_type` partitions that single id space into two namespaces under one DAO. There is **no collision, no duplication, no mis-attribution** (Alpha and Bravo id ranges are disjoint anyway, and `source_type` further separates them). State transitions (`advanceState`, keyed on `source_type`+`source_id`) resolve correctly because each contract emits its own proposals' lifecycle events — recorded here as a relied-upon **invariant**: a future source that re-emits lifecycle events under a different `source_type` would break this assumption.

### Read model / API surface

- The per-DAO list endpoint (`GET /v1/daos/compound/proposals`) is dao-scoped and `source_type`-agnostic, so it returns a unified Alpha+Bravo list with **correct count (~539) and no gaps/dupes** — this closes the M1 acceptance gap. The accepted definition of "complete" is **count parity with Tally**, _not_ a single contiguous `source_id` namespace 1..539 (the system produces two namespaces tagged by `source_type`).
- The detail route is `source_type`-scoped: `GET /v1/daos/:slug/proposals/:source_type/:source_id`. Addressing a historical Compound proposal therefore requires its `source_type` discriminator (Alpha-era proposals live under `compound_governor_alpha`). The list response exposes `source_type` per item so the dashboard can construct correct links; external consumers that know only "Compound proposal N" must list first.
- The exposed per-DAO `?source_type=` filter will now _exclude_ Alpha-era proposals when set to `compound_governor`. This is a behavior change for any client using that filter and a footgun for "all Compound proposals" semantics — flagged for the API/product owners; no code change mandated by this ADR.

### Operational

- Backfill is required for the Alpha contract after migration: `admin-cli backfill start compound_governor_alpha` (depends on the admin-cli generalization above). The backfill path reads `active_from_block` (9601459); the live poller does not.
- **`active_to_block` is intentionally NOT set.** No production code path honors it: `DaoSourceRepository.findAll()` (orchestrator) never selects it, the backfill path selects only `active_from_block`, and `EventPoller` computes its window purely from chain head with no upper bound. Setting the column would be a no-op. Consequently the live poller will issue an `eth_getLogs` for the **defunct Alpha address every poll interval indefinitely**. Alpha is dead (last activity ~block 12006099), so the filter returns empty results forever — **functionally harmless but wasteful** of RPC quota and leaves a permanently idle poller. Accepted for M1.
- **KNOWN-027:** the live orchestrator/poller does not honor `active_to_block`, so closed-out sources (Governor Alpha, and any future migrated contract) cannot be retired from live polling. Resolve by making the orchestrator skip/stop sources whose `active_to_block` is below the current head; then set `active_to_block` on the Alpha `dao_source` row. Target: M2.

### Tests

- Add a `createCompoundGovernorAlphaPlugin` spec mirroring `plugin.spec.ts` (asserts `sourceType === 'compound_governor_alpha'`, shared config schema, shared filter topics). The existing `decoder.spec.ts` topic-0 regression test already covers the shared event signatures and needs no Alpha-specific addition for M1.

### M2 note

Alpha's `VoteCast` uses `bool support` and carries no `reason` string. The Alpha plugin will need a dedicated `VoteCast` decoder entry in M2; this ADR does not prescribe the approach.
