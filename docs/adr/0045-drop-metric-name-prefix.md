# ADR-045 — Drop `OTEL_SERVICE_NAMESPACE` metric-name prefix

- **Status**: Accepted (2026-05-15)
- **Date**: 2026-05-15
- **Spec sections affected**: 3.12, 6.20, 7.4
- **Supersedes in part**: ADR-042 ("Metric name prefix" decision and consequence)

## Context

ADR-042 introduced a `libs/observability` rule that prepended `OTEL_SERVICE_NAMESPACE` to every emitted metric name. In practice this produced names like `kvorum_ingestion_*` and `kvorum_api_*`.

For M1, all metric families are already explicitly namespaced by purpose (`ingestion_*`, `derivation_*`, `api_*`, `rate_limit_*`, `auth_*`). The extra product namespace segment adds coupling without providing meaningful benefit in the current deployment model.

This change happens pre-deployment, before production scrape contracts exist.

## Decision

1. `libs/observability` emits metric names exactly as declared at call sites; no automatic `<namespace>_` prefix is applied.
2. `OTEL_SERVICE_NAMESPACE` remains required and continues to populate the OpenTelemetry resource attribute (`service.namespace`).
3. The authoritative committed metric-family list for M1 is:
   `api_*`, `ingestion_*`, `derivation_*`, `rate_limit_*`, `auth_*`.
4. `docs/SPEC.md` remains frozen at v1.0; this correction is recorded by ADR plus implementation docs (`docs/metrics.md`) rather than direct SPEC edits.

## Consequences

1. **Gain — cleaner stable names.** Emitted series are shorter and family-focused (`api_requests_total`, `ingestion_reorg_event_total`, etc.).
2. **Gain — less rename coupling.** Product renames do not force metric-name rewrites.
3. **Cost — no cross-deployment disambiguation in the metric name itself.** This is accepted for v1: each environment uses a distinct Prometheus target set and distinguishes series by target labels/resource metadata, not by a hardcoded name prefix.
4. **Migration impact — test updates required.** Assertions that expected `${metricPrefix}_...` must switch to bare family names.

## Alternatives considered

1. Keep ADR-042 prefix behavior unchanged. Rejected: redundant name segment and avoidable coupling.
2. Replace with a different global prefix. Rejected: same coupling under a different token.
3. Edit `docs/SPEC.md` directly. Rejected: ADR process governs post-freeze corrections.
