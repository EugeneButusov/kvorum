# ADR-0075 — Snapshot delegation model

**Status:** Accepted
**Date:** 2026-07-01
**Deciders:** Eugene
**Cross-refs:** SPEC §2.5 (`snapshot_delegation`), §3.6; reuses ADR-041 (cross-DB write protocol), ADR-045 (metric naming), ADR-058 (confirmed-head ingest); precedent ADR-070 (delegation parity / lean cut); ADR-064 (multi-chain dao*source binding); contrasts ADR-062 (`delegation_flow*\*` is CH token-power delegation).

---

## Context

Snapshot off-chain proposals and votes are ingested from the GraphQL hub. **Delegation**, however, is not served by that hub — it lives in two **on-chain** registries that Snapshot reads when computing delegated voting power:

1. **Gnosis "Delegate Registry" (V1)** — `0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446`.
   `SetDelegate(address indexed delegator, bytes32 indexed id, address indexed delegate)` /
   `ClearDelegate(...)`. A **single** delegate per `(delegator, id)`, where `id` is the space name
   as `bytes32` (ascii, right-zero-padded) and `id == 0x0` is the **global** scope. A space-specific
   delegation overrides the global one for that space. All three params are indexed → the space
   `id` is topic-filterable.

2. **Gnosis Guild "Split Delegation" (V2)** — `0xDE1e8A7E184Babd9F0E3af18f40634e9Ed6F0905`.
   `Delegation { bytes32 delegate; uint256 ratio }[]` — **multi-delegate, weighted** — with an
   expiration timestamp and a per-delegate opt-out. Events: `DelegationUpdated`,
   `DelegationCleared`, `ExpirationUpdated`, `OptOutStatusSet`. The space (`context`) is a
   **string carried in event data, NOT indexed** → it is not topic-filterable.

This is space- and network-scoped _signaling_ delegation, distinct from the token-power delegation
that `delegation_flow_*` (CH) models for Compound/Aave (ADR-062, ADR-070). It needs its own home.

## Decision

Ingest **both** registries as on-chain EVM sources (reusing the `evm-event-poller` →
`archive_event_*` → `ProjectionDeriver` pipeline) and derive them into a new **PG**
`snapshot_delegation` table. Both ride the existing `snapshot` source plugin.

### Schema — `snapshot_delegation` (PG, append-only, event-sourced)

One row per registry event; current delegation + precedence are resolved at **read** time (store
facts, not state — consistent with the rest of the codebase). Columns: `id` (surrogate uuid pk),
`dao_id` (null = global), `delegator_address`, `delegate_address` (ZERO sentinel on a clear),
`space_id` (null = global), `network` (the registry's canonical `chain_id`, e.g. `'0x1'`),
`delegation_system` (`delegate_registry` | `split_delegation`), `weight` (V2 normalized ratio
fraction; null = full), `expires_at` (V2; null = none), `event_type` (`set` | `clear`),
`block_number`, `log_index`, `tx_hash`, `created_at`. Idempotency:
`UNIQUE (network, tx_hash, log_index, delegate_address)` — a clear's non-null ZERO sentinel lets
the key fire on re-derivation, paired with `ON CONFLICT DO NOTHING` (PG is not idempotent like CH's
`ReplacingMergeTree`).

### One dao_source per registry, dao attribution from the decoded space

Each registry is an **ecosystem-global single contract**, not a per-DAO source. The live consumer
routes a log by `(chain_id, address)` to a single dao_source (the `SourceResolver` keys on that
tuple), so a contract address **cannot** fan to multiple dao_sources. We therefore seed exactly
**one** dao_source per registry (trigger-owner `lido`, on `0x1`), topic-scope V1 to the seeded
space ids + the global id, and have the **deriver recover the real `dao_id` from the decoded
space** (V1 `bytes32 id` → space name → the `snapshot` dao_source's dao; V2 `context` string → the
same). This **inverts the usual convention** where a deriver attributes rows to its dao_source's
dao via `findDaoIdForSource`; here `dao_source.dao_id` is only the ingester trigger-owner. Global
(V1 `id == 0x0`) rows carry `dao_id = NULL` (they apply to every space).

### Precedence and the two systems

- **V1 current** = the latest (by block, log) non-cleared **space-specific** delegation; else the
  latest non-cleared **global** delegation; else none (space-over-global).
- **V2 current** = the delegate set at the latest non-cleared coordinate, minus any expired at read
  time. `DelegationUpdated`/`ExpirationUpdated` project N weighted `set` rows (the new/refreshed
  set); `DelegationCleared` (or an empty array) projects one `clear` row. A `bytes32` delegate is
  decoded as a left-zero-padded EVM address; a non-zero upper word is a cross-chain id we cannot
  represent and is skipped.

### Lean edges (explicit, not silent)

- **Relationship-only** (`delegationModel = 'relationship-only'`): the events carry no per-delegation
  power figure, exactly like Aave's parity cut (ADR-070). Effective power is computed elsewhere.
- **`OptOutStatusSet` is archived but no-op derived** (marked derived, no projection row). Resolving
  a delegate's opt-out into effective delegation at read time is deferred to a follow-up; it does
  not change the delegation graph this table records.
- **V2 firehose:** because `context` is un-indexed, the V2 ingester subscribes by event signature
  and **drops out-of-scope contexts before archiving** (a post-decode filter on both the live and
  backfill paths), so only the seeded spaces are persisted.

## Consequences

- `snapshot_delegation` is populated for `lido-snapshot.eth` (and the other seeded spaces) from both
  registries; "current Snapshot delegation" derives with space-over-global precedence (V1) and
  weighted multi-delegate sets (V2). No change to `delegation_flow_*` or any existing read.
- The dao-from-space attribution and the single-dao_source design are first-in-repo; both are forced
  by the shared-contract routing model and are documented above.
- Deferred fidelity (opt-out read resolution, cross-chain bytes32 delegates) is recorded, not hidden.
- `active_from_block` for both contracts is the deploy block (operator-verified at backfill
  registration per ADR-058's confirmed-head model; live polling reads from tip).

## Alternatives considered

- **Subgraph poll instead of on-chain events.** Rejected — adds a transport with no existing harness;
  the registries are canonical contracts the EVM pipeline already handles deterministically.
- **N dao_sources (one per space) to preserve `findDaoIdForSource`.** Impossible: `SourceResolver`
  collapses one contract address to one dao_source, so per-space dao_sources on the same registry
  would collide. The decoded-space attribution is the honest model.
- **Defer V2 (Split Delegation) to a follow-up (ADR-070-style lean cut).** Considered; the owner
  chose to ship both systems now. V2's heavier surface (multi-delegate weights, expiration, the
  un-indexed-context firehose) is carried here, with only opt-out read-resolution deferred.
- **Current-state upsert instead of append-only event rows.** Rejected — append-only matches the
  codebase (events are facts; current state is a read concern) and keeps precedence auditable.
