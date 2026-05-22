# ADR-0057: Unified Source Plugin Contract

- Status: accepted
- Date: 2026-05-22

## Context

Source integration previously used separate surfaces for ingesters and derivation concerns. That split made module wiring source-specific in multiple places.

## Decision

Adopt a unified `SourcePlugin` bundle in `@sources/core`:

- `SourcePlugin = { name, ingesters, derivers }`
- `SourceIngester` is the per-source-type ingestion contract (former `SourcePlugin` body)
- `SourceDeriver` is a discriminated union with `kind` (`projection` or `actor-address`)
- `SOURCE_PLUGINS` remains the single token name and now carries `SourcePlugin[]`

Nest integration is centralized in `nest/sources/sources.module.ts`, which aggregates per-source bundles.

## Consequences

- Source-specific Nest modules are imported in one place only (`SourcesModule`)
- Indexer orchestrator still consumes flat ingesters via `plugins.flatMap(p => p.ingesters)`
- Derivation worker consumes derivers via `plugins.flatMap(p => p.derivers)` and filters by `kind`
- Future deriver families extend the `SourceDeriver` union without adding new global tokens
