# ADR-0064: Multi-chain dao_source binding and chain-aware derivation dispatch

- **Status**: Accepted
- **Date**: 2026-06-01
- **Amends**: 0062, 0063
- **Related**: ADR-0058, epic #239, R0 #247, R1 #248, R2 #249, R3 #250

## Context

Aave uses one logical DAO across multiple chains under a single `source_type`. The derivation
worker previously dispatched archive rows by `(source_type, event_type)`, which allows a
single batch to mix chains. At the same time, the broader `dao_source` to chain binding
model needs to become explicit for multi-chain sources.

## Decision

### Chain-aware derivation dispatch (R0)

The derivation worker dispatches underived archive rows by
`(source_type, chain_id, event_type)`, not `(source_type, event_type)`.

Each `applyBatch` call therefore receives a single-chain batch by construction. Projection
appliers may rely on this invariant. The `ProjectionDeriver` interface does not change; only
the guarantee on each invocation is narrowed.

### dao_source.chain_id binding (R1)

R1 moves chain binding to the source row itself:

- add `dao_source.chain_id varchar(32) NOT NULL DEFAULT '0x1'`
- backfill existing rows from `dao.primary_chain_id`
- update all source-resolution consumers to read `dao_source.chain_id`
- require `admin-cli daos source add --chain <id>` so operator writes are explicit

`dao.primary_chain_id` remains the DAO home-chain attribute (API and DAO-level semantics).
It is no longer the source-resolution authority.

R3 hand-off (recorded here intentionally):

- relax `UNIQUE(dao_id, source_type)` to `UNIQUE(dao_id, source_type, chain_id)`
- update both committed Compound seeds to match new conflict target:
  - `libs/sources/compound/migrations-postgres/compound_002_seed.ts` (5 statements)
  - `libs/sources/compound/migrations-postgres/compound_003_comp_token.ts` (1 statement)
- make seed inserts explicit on `chain_id`
- drop `dao_source.chain_id DEFAULT '0x1'`

The deferral is deliberate: R1 avoids editing committed historical migrations while Compound is
single-chain and before multi-row-per-source-type Aave seeds are introduced.

### AC#4 reinterpretation (R1)

R1 adds a core-entity column (`dao_source.chain_id`), and this is acknowledged directly.
The compatibility argument is that `dao_source` is the SPEC's configuration/decoupling layer
(SPEC §2.4.2), where binding metadata like activation windows already lives.

So this change is configuration-layer metadata about where a source runs, not a change to
cross-DAO query semantics (proposal/vote/delegation abstractions) protected by SPEC §10.5 AC#4.

R1 does not rely on SPEC §2.5 extension-table pre-sanctioning for this claim. That scope is
reserved for R2 vote-chain dimensions and Aave extension tables.

### AC#4 reinterpretation (R2)

R2 extends the data model in two places:

- vote projection chain dimension: `vote_events_*` adds `voting_chain_id` (the chain where the
  vote was cast)
- Aave extension tables in PG: `aave_proposal_metadata` and `aave_proposal_payload`

These are compatibility-layer additions, not core semantic changes:

- the vote/proposal/delegation abstractions stay unchanged
- chain-specific Aave metadata lives in extension tables sanctioned by SPEC §2.5
- `voting_chain_id` is a derived projection dimension used for chain-aware reads and does not
  alter proposal/vote identity semantics

Therefore SPEC §10.5 AC#4 remains satisfied for Epic R.

### Per-source seeds and seeded-ahead skip (R3)

R3 fulfills the recorded hand-off in the creation migrations:

- `dao_source` is unique by `(dao_id, source_type, chain_id)`, allowing one logical DAO to bind
  the same source type on multiple chains.
- `dao_source.chain_id` no longer defaults to Ethereum mainnet; every seed must write it
  explicitly.
- the committed Compound seeds write `chain_id = '0x1'` and use the three-column conflict target.

R3 also permits registry rows to land before their adapters. During orchestrator bootstrap, a
`dao_source` row whose `source_type` has no registered ingester is skipped with a warning and the
`indexer_seeded_source_no_plugin` counter. The `source_type` value is still FK-bound to the
reference table, so this state represents a seeded source awaiting implementation rather than a
free-form typo.

The fail-fast for missing chain configuration remains in place for registered ingesters. Once a
source type has code, lack of `CHAIN_CONFIG` coverage is an operator provisioning error.

## Consequences

- Cross-chain head-of-line blocking is deferred to Epic Y. Mechanism:
  `findDerivableBy` orders `chain_id ASC` with no `derivation_attempt_count` cap, and
  appliers can DLQ a persistently failing row without calling `markDerived`. Under a real
  multi-chain backlog, low `chain_id` rows can repeatedly occupy `LIMIT` batches and starve
  higher chains.
- R0 intentionally left `findDerivableBy` unchanged. Compound remained single-chain (`0x1`),
  so the deferred liveness issue cannot manifest before Aave multi-chain backlog exists.
- R1 makes per-source chain binding explicit and compiler-enforced in typed writes.
