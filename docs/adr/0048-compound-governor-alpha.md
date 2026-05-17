# ADR-048 — Index Compound Governor Alpha as `compound_governor_alpha`

**Status:** Accepted  
**Date:** 2026-05-17

---

## Context

Compound DAO has governed on-chain through two successive contracts:

| Contract       | Address                                      | Deploy block | Proposals     |
| -------------- | -------------------------------------------- | ------------ | ------------- |
| Governor Alpha | `0xc0dA01a04C3f3E0be433606045bB7017A7323E38` | 9 601 459    | 1 – ~64       |
| Governor Bravo | `0xc0Da02939E1441F497fd74F78cE7Decb17B66529` | 12 006 099   | ~65 – present |

M1 acceptance validation found 351 derived proposals against 539 on Tally — a gap of ~188 proposals that maps exactly to the Alpha contract not being indexed.

The two contracts share an identical `ProposalCreated` ABI:

```
ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values,
                string[] signatures, bytes[] calldatas,
                uint256 startBlock, uint256 endBlock, string description)
```

Same parameters → same topic hash → the existing Bravo decoder handles Alpha logs without modification.

The contracts diverge on `VoteCast`:

|           | Alpha                                                                | Bravo                                                                                           |
| --------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| signature | `VoteCast(address voter, uint proposalId, bool support, uint votes)` | `VoteCast(address indexed voter, uint proposalId, uint8 support, uint256 votes, string reason)` |

`VoteCast` is out of M1 scope (deferred to M2).

---

## Decision

Add `compound_governor_alpha` as a second source type that re-uses all M1 Bravo primitives (decoder, archive writer, ingester listener, projection applier). A thin `createCompoundGovernorAlphaPlugin` factory sets `sourceType: 'compound_governor_alpha'`; everything else is shared.

---

## Options considered

**A — Multi-address filter on existing `compound_governor`**  
Extend `source_config` from `{governor_address: string}` to `{governor_addresses: string[]}` and index both contracts under one source type.  
Rejected: conflates two distinct governance eras; complicates M2 where `VoteCast` ABIs differ; requires config-schema migration on the live `dao_source` row.

**B — New source type, shared implementation (chosen)**  
New `compound_governor_alpha` source type, separate `dao_source` row, thin plugin wrapper delegating to Bravo code.  
Clean per-source filtering, no duplication for M1, natural extension point when M2 needs separate `VoteCast` handling.

**C — New source type, fully duplicated code**  
Unnecessary; `ProposalCreated` is ABI-compatible so there is nothing to diverge.

---

## Consequences

- New `compound_governor_alpha` value inserted into `source_type` reference table (migration `compound_004_governor_alpha.ts`).
- New `dao_source` row: compound DAO, `source_type = compound_governor_alpha`, `source_config = {"governor_address": "0xc0dA01a04C3f3E0be433606045bB7017A7323E38"}`, `active_from_block = 9601459`.
- `createCompoundGovernorAlphaPlugin` added to `libs/sources/compound`; `createCompoundGovernorPlugin` refactored to share an internal factory.
- `CompoundSourceModule` (`nest/sources/compound`) exposes `COMPOUND_ALPHA_PLUGIN`.
- `IndexerModule` (`apps/indexer`) injects both plugins into `SOURCE_PLUGINS`.
- Backfill required for Alpha contract after migration: `admin-cli backfill start compound_governor_alpha`.
- **M2 note:** Alpha's `VoteCast` uses `bool support` and carries no `reason` string. The Alpha plugin will need a dedicated VoteCast decoder entry in M2; this ADR does not prescribe the approach.
