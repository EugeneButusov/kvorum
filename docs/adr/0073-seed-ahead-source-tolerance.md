# ADR-073 — Seed-ahead source tolerance

**Status:** Accepted
**Date:** 2026-06-21
**Issue:** Epic Z [#309](https://github.com/EugeneButusov/kvorum/issues/309)
**Related:** [ADR-064](./0064-multi-chain-dao-source-binding.md), [ADR-071](./0071-non-evm-ingestion-contract.md)

---

## Context

M4 seeds `dao_source` rows for sources whose plugins are built in later tasks: the source seeds add
the `snapshot` (AD1) and `discourse_forum` (AE2) off-chain sources, and defer the Dual Governance /
Easy Track EVM sources to AB0 / AC1. This "seed-ahead-of-plugin" sequencing is deliberate — the
seeds are shared infrastructure (a DAO's full source set) and want to land before the per-source
plugins so each plugin task is purely additive.

Two startup paths assumed, before these seeds, that **every** `dao_source` row is immediately
ingestable:

1. **Indexer orchestrator** (`indexer-orchestrator.service.ts`) pre-validated all rows and **threw**
   `No plugin registered for source_type="…"` on the first row whose `source_type` had no registered
   `SourceIngester`. Because validation is fail-fast and pre-driver, a single seeded-ahead row took
   down **all** ingestion (including live Compound/Aave) at `onApplicationBootstrap()`.

2. **admin-cli backfill orchestrator** (`backfill-plan.ts` + `backfill-orchestrator.ts`) dropped
   only `_reconcile` rows from the plan, so off-chain rows reached the readiness gate, which flags
   any `chain_id` absent from `CHAIN_CONFIG` (off-chain rows carry the `off-chain` sentinel) and
   **aborts the entire run before writes**. Since the seeds add Snapshot on Aave + Compound, their
   `admin-cli backfill` would have regressed.

`dao_source.source_type` is FK-constrained to `source_type(value)`, so neither path can ever see a
typo'd source_type — the only states the throw/abort guarded were "plugin not built yet" (intended)
and "plugin built but not registered in Nest" (a real bug).

## Decision

**A seeded `dao_source` whose plugin or transport is not yet available is skipped, not fatal.**

1. **Orchestrator:** when no plugin is registered for a row's `source_type`, log
   `dao_source_no_plugin` (warn) + increment the `dao_source_unregistered{source_type}` counter, and
   `continue`. Registered sources start normally. This is **distinct** from the pre-existing,
   intentionally-silent "plugin present but chain unsupported" skip (`supportedChainIds`): the
   no-plugin skip is observable (warn + metric); the chain-unsupported skip stays silent.

2. **Backfill plan:** the EVM backfill plan keeps **only** sources a registered plugin declares
   `backfillable` for (`isBackfillableSourceType`). `SourceIngester` gains a declarative
   `readonly capabilities: readonly SourceCapability[]` field; EVM event-log sources declare
   `['backfillable']`, reconcile sweeps and off-chain sources do not. Backfill eligibility is read
   directly off the plugin's declared capability instead of inferred from a `chain_id` sentinel or a
   `_reconcile` suffix. This single positive whitelist replaces both prior implicit checks. Off-chain
   backfill is a separate transport (AG1, Snapshot `created_gte` pagination with no head-lag); the
   EVM plan never enumerates off-chain rows. This is a **permanent** exclusion, unlike the
   orchestrator's no-plugin skip which resolves itself the moment AD1/AE2 register their plugins.

## Consequences

- The seed migrations can add Snapshot ×3 + Discourse ×3 dao_source rows without crashing the live indexer or
  breaking Aave/Compound backfill. As AD1/AE2 land, their source_types acquire plugins and the
  orchestrator starts polling them with no further change.
- **Observability is the safety net for the swallowed "forgot to register" case.** A non-zero
  `dao_source_unregistered` counter in a deploy that was supposed to register a plugin is a
  release-gate signal — wire it into deploy alerting. Without it, a missing plugin registration
  would silently mean "that source never ingests."
- **Availability improves regardless:** one unbuilt or misregistered source can no longer
  take down all ingestion in a multi-source indexer.
- Rejected alternatives: a per-row `enabled`/`active` flag (adds schema + an operational toggle for
  no benefit over skip-on-no-plugin, since the FK already blocks typos); stub no-op plugins (throwaway
  code, and `discourse_forum` has no package to host a stub at seed time); deferring the seeds until
  the plugins exist (defeats the additive-plugin sequencing M4 is built around).
