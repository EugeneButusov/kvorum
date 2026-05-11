# ADR-042 — Adopt OpenTelemetry as the observability SDK; Prometheus as the M1 wire format

- **Status**: Accepted (2026-05-11)
- **Date**: 2026-05-11
- **Spec sections affected**: 3.12, 6.20
- **Related**: ADR-038 (CH archive in M1 — many of the existing instruments serve that pipeline), ADR-041 (cross-DB contract metric names), `docs/planning/plan-metrics-rename.md` (execution plan)

## Context

`libs/chain/src/metrics/metrics.ts` instruments the codebase via 24 lazy-singleton `get*()` helpers wrapping `prom-client` `Counter`/`Gauge`/`Histogram` instances. The accessor shape is unergonomic — `getLogsFetchedTotal().inc(...)` reads like a value getter, and `await getHeadBlockAgeSeconds().get()` (double `get`) is the friction made literal. No `/metrics` HTTP endpoint exists in any Node process today; the scrape surface is unbuilt.

The codebase is **pre-deployment**. Nothing scrapes the metrics; no Grafana panels, alert rules, or runbooks reference any series. The instruments today exist only for unit tests to assert on. This is decisive for the framing: the work is **creating** the observability subsystem, not **migrating** a live one.

While planning the cleanup, three issues surfaced that pushed the scope beyond a simple rename:

1. **Producer locality.** F1's "archive" instruments live in `libs/chain` despite being generic-with-source-label and written from `libs/sources/compound`. The right answer is structural, not cosmetic.
2. **Multi-process exposure.** The indexer — which produces most existing instruments — runs as `NestFactory.createApplicationContext` and binds no port. Every Node process is its own Prometheus scrape target; exposure is unbuilt across the board.
3. **SDK choice.** With the surface this small (~24 instruments, ~20 call sites) and no production consumers, M1 is the right moment to choose the long-term SDK. The same files would otherwise be touched twice — once now for the rename, once later for any future migration.

Three drivers tip the SDK choice toward OTel:

- **Three-signal optionality.** OTel is one SDK for metrics, traces, and logs with one export pipeline. Distributed tracing across `apps/api` → `apps/indexer` → `apps/ai-worker` is not in M1 scope, but the architecture is naturally request/event-correlated and will benefit from tracing by M3–M5. With `prom-client` we'd separately pick a tracer (Jaeger / Tempo / OTel-anyway) and a log-trace correlation layer later — two more architectural decisions paid for in delayed effort.
- **Backend portability.** Prometheus is the wire format today (text exposition over `/metrics`), but OTel makes the backend a configuration switch: Prometheus exporter today, OTLP push to Grafana Cloud / Honeycomb / Datadog tomorrow without call-site changes. M1 doesn't need this; M3+ might.
- **Industry trajectory.** OTel is CNCF-graduated; Prometheus itself ingests OTLP natively now. New observability backends increasingly assume OTel as input.

## Decision

**Adopt OpenTelemetry as the observability SDK for v1, with the Prometheus exporter as the M1 wire format.**

Concretely:

- **SDK packages**: `@opentelemetry/api`, `@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-prometheus`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`. Per-instrumentation packages added on demand.
- **Wire format (M1)**: Prometheus text exposition served from `GET /metrics` on every Node process that produces metrics — `apps/api`, `apps/indexer`, `apps/ai-worker`.
- **Wire format (post-M1)**: OTLP push to a collector becomes a configuration change. No call-site rewrites.
- **Tracing / structured logs**: the OTel SDK is installed; instrumentation is deferred to the milestone that needs it. The same `MeterProvider` / future `TracerProvider` / Resource scaffold gets reused.
- **Call-site API**: OTel-native. `counter.add(value, attrs)`, `gauge.record(value, attrs)`, `histogram.record(value, attrs)`. No prom-client-style façade.
- **Core location**: new framework-agnostic `libs/observability` package (same boundary rule as `libs/chain` / `libs/sources/*`). Apps may import; libs may import; framework deps are forbidden.
- **HTTP exposure**: `apps/api` (Nest HTTP) mounts a thin `MetricsController` calling `renderMetrics()`. Workers (`apps/indexer`, `apps/ai-worker`) — which use `NestFactory.createApplicationContext` and have no main port — run an `OpsServer` Nest provider that binds a plain `http.createServer` on an ops port (`OPS_PORT`, default `9091`) and tears it down via `OnApplicationShutdown`. CLAUDE.md's "workers don't bind a port" rule refers to the worker's _main service port_; an ops port is a separate, low-traffic concern.
- **Service identity per process**: each app sets `OTEL_SERVICE_NAME` (`api`, `indexer`, `ai-worker`) and `OTEL_SERVICE_NAMESPACE` (configurable; no hardcoded product name in the library) in `main.ts` before the Nest context is built. These flow into OTel Resource attributes and Prometheus `target_info`.
- **Metric name prefix**: `libs/observability` reads `OTEL_SERVICE_NAMESPACE` at module load and prepends it to every instrument name. Source code declares instruments as `'ingestion_rpc_requests'`; the namespace gets prepended at emit time. No hardcoded `kvorum_*` literal anywhere in source — aligns with the project's rename-safety principle (env vars, `@libs/` namespace, etc.).

### Pre-deployment framing — what this lets us skip

Because no live consumer exists today, the design explicitly **does not** include:

- A name-preservation gate, byte-for-byte exporter-output verification, or any compatibility shim.
- A rollback runbook or scrape-config stub deliverable (no scrape exists to roll back).
- Operator-coordination steps (no operator runs the system yet).
- A "what is not changing" preservation contract.

Existing instrument names are kept where they're already well-chosen because changing them is churn for no benefit. They are not preserved as a contract.

### Why OTel-native call sites, not a façade

A `prom-client`-style façade backed by OTel internally was considered and rejected:

- Call-site rewriting is the same effort either way — every site changes shape exactly once.
- A façade hides OTel's primitives. Engineers will eventually want OTel features (exemplars, observable instruments, view-based aggregation, semantic-convention attributes) and the façade becomes either a leak or a maintenance burden.
- OTel's `.add()` / `.record()` are terse and unambiguous; the original "looks like a value getter" problem doesn't recur.

### Counter naming convention

OTel-idiomatic counters do not include the `_total` suffix in their declared name — the Prometheus exporter appends it automatically. `libs/observability`'s `defineCounter` enforces this by throwing on any `name` ending in `_total`. Histograms with `_seconds` / `_blocks` keep those as semantic name suffixes; the OTel `unit` field is left unset (the JS exporter does not append unit suffixes to the wire-format name regardless).

### Test isolation strategy

OTel `MeterProvider.shutdown()` is terminal per spec. The natural fit for Vitest test isolation is `vi.resetModules()` + lazy dynamic imports inside `beforeEach`. `libs/observability` exposes a `shutdownForTest()` helper; spec files import metric modules dynamically after `resetModules`. The execution plan documents the pattern.

## Alternatives considered

1. **Keep `prom-client`.** Lower-risk in isolation. Forfeits three-signal optionality and backend portability. Same call sites touched again on any future OTel migration. Rejected: timing is uniquely favorable (small surface) and the gain compounds across M2–M6.
2. **`prom-client` now, OTel later, with a thin façade in `libs/observability`.** Considered seriously. Rejected: same call-site sweep eventually, plus a façade we'd remove. Net: more total work.
3. **Adopt OTel for metrics _and_ tracing in M1.** Rejected as overreach. Tracing has no immediate consumer in M1 and adds non-trivial wiring (Resource attributes, Context propagation across worker boundaries, span sampling). Install the SDK; defer instrumentation.
4. **Use `@willsoto/nestjs-prometheus` as a Nest adapter.** Considered. Rejected as the wrong coupling: that library speaks `prom-client` directly. With OTel we write ~15 lines of Nest glue (`MetricsController` + an `OpsServer` provider) and skip a third-party Nest dep.

## Consequences

1. **Gain — one SDK for the full observability story.** Metrics now; tracing and structured logs unlock by configuration when their milestones land.
2. **Gain — backend portability by configuration.** Prometheus today, OTLP push to a managed backend tomorrow. No call-site changes.
3. **Gain — semantic-convention alignment available.** New HTTP/DB instruments can adopt OTel semantic conventions (`http.server.request.duration` with standard attributes), reducing bikeshed.
4. **Gain — rename-safe metric prefix.** Source no longer hardcodes the product name. `OTEL_SERVICE_NAMESPACE` flip renames every emitted series; library code stays stable.
5. **Cost — heavier SDK surface at boot.** Multiple `@opentelemetry/*` packages. `MeterProvider`, `Resource`, `PrometheusExporter` assembled at process boot in `libs/observability`. One-time cost, encapsulated.
6. **Cost — `@opentelemetry/exporter-prometheus` is still on the `0.x` experimental version band.** Pin exact minor in root `package.json`; isolate all exporter-touching code behind `libs/observability` so a bump is a single-file change.
7. **Cost — call-site API shape changes.** Every `.inc(...)` becomes `.add(1, {...})`, every `.set(...)` and `.observe(...)` becomes `.record(...)`. ~20 files; mechanical sweep documented in the execution plan.
8. **Cost — `vi.resetModules()` discipline in spec files.** Each spec that touches metrics must use the lazy-import pattern. Uniform; easy to enforce by review.
9. **Cost — sync `Gauge` requires recent OTel JS releases.** Synchronous `Gauge` (spec 1.31, early 2024) is available in current stable; minor-version pins lock it in.
10. **Risk — OTel JS SDK churn.** The metrics SDK API stabilized in 2024 (SDK 2.0 GA in March 2025); we depend only on the stable surface (`api`, `sdk-metrics`, `exporter-prometheus`).
11. **Risk — webpack double-bundling of `@opentelemetry/api`.** A known gotcha — two copies cause the global API singleton to diverge and metrics silently no-op. Verify with `webpack-bundle-analyzer` if a smoke test ever shows missing series.
12. **Process — execution lives in `docs/planning/plan-metrics-rename.md`.** PR0 spike → PR1 core + sweep → PR2 HTTP exposure.

## References

- OpenTelemetry JS SDK — `https://opentelemetry.io/docs/languages/js/`
- OTel Metrics specification — `https://opentelemetry.io/docs/specs/otel/metrics/`
- OTel JS SDK 2.0 announcement (March 2025) — `https://opentelemetry.io/blog/2025/otel-js-sdk-2-0/`
- `@opentelemetry/exporter-prometheus`
- ADR-038 — origin of most M1 instruments
- ADR-041 — cross-DB contract; instrument names referenced
