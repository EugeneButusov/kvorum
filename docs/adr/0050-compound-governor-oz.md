# ADR-050 — Index Compound Governor OZ as `compound_governor_oz`

**Status:** Accepted  
**Date:** 2026-05-19

## Context

Compound governance has a third on-chain era at `0x309a862bbC1A00e45506cB8A802D1ff10004c8C0` (deployed at block `21688680`) with proposal ids continuing from Bravo (`394+`). We currently miss these proposals.

The contract is an OZ-based governor, but for M1 lifecycle events (`ProposalCreated`, `ProposalQueued`, `ProposalExecuted`, `ProposalCanceled`) ABI and payload layout are compatible with existing Compound shared code paths.

## Decision

Add a new source type `compound_governor_oz` and reuse existing Compound M1 primitives:

1. Add Postgres migration `compound_003_governor_oz.ts` to seed:

- `source_type.value = 'compound_governor_oz'`
- `dao_source` row for `compound` with `governor_address=0x309a...c8C0` and `active_from_block=21688680`

2. Keep ClickHouse archive table unchanged (shared `event_archive_compound_governor_bravo` remains valid).
3. Add `createCompoundGovernorOzPlugin` and include it in `createCompoundPlugins`.
4. Extend `CompoundProjectionApplier.sourceTypes` to include `compound_governor_oz`.
5. Extend reconciler coverage by changing `CompoundStateReconciler.sourceType` to `sourceTypes = ['compound_governor_bravo', 'compound_governor_oz']`.

## Consequences

- Compound list endpoint stays unified across source types and now includes missing OZ-era proposals.
- Detail endpoint remains source-type scoped; clients must pass `compound_governor_oz` for OZ proposals.
- `compound_governor_alpha` remains excluded from reconciliation; `compound_governor_oz` is included because it is active and has the same event-silent state-transition gap as Bravo.
- `active_to_block` is intentionally unset for OZ because this is the live governor.
