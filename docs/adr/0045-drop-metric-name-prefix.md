# ADR-045 — Replace `OTEL_SERVICE_NAMESPACE` metric-name prefix with per-service prefix

- **Status**: Accepted (2026-05-15)
- **Date**: 2026-05-15
- **Spec sections affected**: 3.12, 6.20, 7.4
- **Supersedes in part**: ADR-042 ("Metric name prefix" decision and consequence)

## Context

ADR-042 introduced a `libs/observability` rule that prepended `OTEL_SERVICE_NAMESPACE` to every emitted metric name. In practice this produced names like `kvorum_ingestion_*` and `kvorum_api_*`.

We need to remove product-coupled `kvorum_` names while still preserving a stable prefix that identifies the emitting app (`api`, `indexer`, `ai-worker`).

## Decision

1. `libs/observability` prepends a sanitized `OTEL_SERVICE_NAME` prefix to every emitted metric name.
2. `OTEL_SERVICE_NAMESPACE` remains required and continues to populate the OpenTelemetry resource attribute (`service.namespace`).
3. `OTEL_SERVICE_NAME` is required at observability module load and drives both resource `service.name` and metric-name prefix.
4. M1 committed families (after service prefixing) are:
   `api_api_*`, `api_auth_*`, `api_rate_limit_*`, `indexer_ingestion_*`, `indexer_derivation_*`, plus related indexer archive/dual-write families.
5. `docs/SPEC.md` remains frozen at v1.0; this correction is recorded by ADR plus implementation docs (`docs/metrics.md`) rather than direct SPEC edits.

## Consequences

1. **Gain — removes `kvorum_` coupling.** Product rename does not require metric-name rewrites.
2. **Gain — keeps source attribution in metric names.** Emitting app is visible directly in series names.
3. **Cost — names are longer.** Families now include service + domain prefixes (for example `api_api_requests_total`).
4. **Migration impact — assertions update.** Tests must assert service-prefixed names.

## Alternatives considered

1. Keep ADR-042 namespace prefix behavior unchanged. Rejected: unwanted `kvorum_` coupling.
2. Drop all prefixing entirely. Rejected: loses direct service attribution in metric names.
3. Edit `docs/SPEC.md` directly. Rejected: ADR process governs post-freeze corrections.
