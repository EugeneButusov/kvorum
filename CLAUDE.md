# CLAUDE.md — Kvorum

Guidance for Claude Code working in this repo.

## Stack snapshot (M1)

| Layer               | Choice                       | Notes                                                                                     |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Runtime             | Node 24 LTS                  | `.nvmrc` pins the minor                                                                   |
| Package manager     | pnpm 11                      | workspace monorepo; use `-w` for root scripts                                             |
| Build orchestration | pnpm scripts                 | `pnpm -r run build/test`, `pnpm -w lint/typecheck`                                        |
| API                 | NestJS 11                    | `apps/api` — HTTP + REST                                                                  |
| Workers             | NestJS 11 standalone context | `apps/indexer`, `apps/ai-worker` — ops HTTP on `OPS_PORT` (default 9091)                  |
| Dashboard           | Next.js 16 App Router        | `apps/dashboard`, Turbopack dev                                                           |
| Database (primary)  | PostgreSQL 18                | Kysely query builder + built-in Migrator                                                  |
| Database (archive)  | ClickHouse 24                | `@founderpath/kysely-clickhouse` dialect for queries; `clickhouse-migrations` npm for DDL |
| Testing             | Vitest 4                     | all packages — `vitest run`; `globals: true`; aliases via `vite-tsconfig-paths`           |
| Language            | TypeScript 5.7               | strict + noUncheckedIndexedAccess                                                         |
| Linting             | ESLint 9 flat config         | `typescript-eslint` recommended; root config covers all packages                          |
| Formatting          | Prettier 3                   | enforced in pre-commit via Lefthook                                                       |
| Git hooks           | Lefthook                     | pre-commit: format + typecheck (no pre-push block)                                        |
| Admin CLI           | commander 14 (Node ESM)      | `apps/admin-cli` — operator tooling, single-file bundle                                   |
| Chain client        | ethers v6 (HTTP)             | failover wrapper in `libs/chain`; WS deferred per ADR-037                                 |

ClickHouse is the source of truth for chain-event-derived data (`vote_events_flat`, `delegation_flow_flat`, `voting_power_snapshot_flat`) from PR-1 (#217) onward. PostgreSQL keeps identity (`actor`, `actor_address`, `actor_address_redirect`), configuration, the proposal state machine, and the `archive_event` derivation watermark. See ADR-0062 (PR-3 #219) for the boundary contract.

## Module boundaries

| Layer                   | Members                                                                                             | Can depend on                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `libs/utils`            | framework-agnostic utilities (`sleep`, …)                                                           | nothing                                              |
| `libs/auth`             | framework-agnostic API-key auth primitives (bearer parse, pepper decode, HMAC hash/verify)          | nothing                                              |
| `libs/domain`           | domain types                                                                                        | nothing                                              |
| `libs/observability`    | OTel MeterProvider, `defineCounter/Gauge/Histogram`, `renderMetrics()`, `shutdownForTest()`         | nothing                                              |
| `libs/db`               | Kysely clients (`pgDb`, `chDb`), DB schema types                                                    | `libs/domain`                                        |
| `libs/chain`            | chain helpers; exports `chainMetrics`                                                               | `libs/domain`, `libs/utils`, `libs/observability`    |
| `libs/ai`               | AI helpers                                                                                          | `libs/domain`, `libs/utils`                          |
| `libs/sources/<source>` | per-source primitives (ABI/decoder, archive writer, ingester listener factory) — framework-agnostic | `libs/domain`, `libs/db`, `libs/chain`, `libs/utils` |
| `apps/*`                | applications                                                                                        | any lib                                              |

These boundaries are not enforced by a linter rule (nx removed). Respect them manually — cross-lib deps beyond what's listed above require a clear architectural reason.

`libs/sources/*` packages stay framework-agnostic: do NOT add `@nestjs/common` or other framework deps. NestJS DI is applied at the apps/indexer composition root, which registers the lib's plain classes via `useFactory` providers. This keeps the source primitives reusable from the backfill driver (Epic I) and any future non-Nest consumer. Unified source bundle contract is defined in ADR-0057.

## Database access convention

Use Kysely query builder methods (`pgDb.selectFrom(…).where(…).execute()`) by default for all Postgres queries. Use the `sql` tagged-template helper only when the query builder genuinely cannot express the operation (e.g., `pg_notify`, recursive CTEs, partial unique index definitions). Every `sql` template tag parameterises values — never interpolate user-controlled data directly. Document the reason when reaching for raw SQL.

For ClickHouse queries use `chDb` (the `@founderpath/kysely-clickhouse` Kysely instance). Use `SELECT … FINAL` when reading from `ReplacingMergeTree` tables to get deduped results; **never** issue `OPTIMIZE TABLE FINAL` from application code or scheduled jobs — that is reserved for manual operator intervention only.

### Cross-DB writes (ADR-041, ADR-058)

All archive writes follow the PG-first-then-CH-then-PG protocol:

1. PG existence check: `SELECT id FROM archive_event WHERE (source_type, chain_id, tx_hash, log_index) = (…)`.
2. CH insert (idempotent via `ReplacingMergeTree`).
3. PG insert with `ON CONFLICT DO NOTHING` + bounded retry (3 attempts × exponential backoff 200/600/1800 ms).
4. DLQ row on persistent PG failure.

Every ingested event is structurally canonical at write time (reads at `confirmedHead = tip − headLag` per ADR-058). The `archive_event` table is a 4-tuple idempotency cache and derivation watermark; there is no `confirmation_status` column or promotion sweep. See ADR-041 for the full write-protocol contract and ADR-058 for the confirmed-head-only model.

## Pre-commit checks

Every commit must pass all four checks before pushing:

```bash
pnpm -w format:check
pnpm -w lint
pnpm -w typecheck
pnpm -w test
```

Lefthook enforces formatting and typecheck on staged files at `git commit`. There is no pre-push block — `lint` and `test` run manually + in CI only. Do not use `--no-verify`.

No `sqlfluff` is configured: Kysely TS migrations contain sql-tagged template literals that sqlfluff cannot parse, and ClickHouse `.sql` migration files (under `libs/sources/*/migrations-clickhouse/`) are reviewed by hand.

### Running integration tests locally

```bash
docker compose up -d postgres anvil clickhouse redis
pnpm -w db:migrate
pnpm -w db:migrate:ch
ANVIL_RPC_URL=http://localhost:8545 pnpm --filter indexer test
REDIS_URL=redis://localhost:6379 pnpm --filter api test
NEST_HTTP_TESTS=1 pnpm --filter api test:e2e
```

## NestJS workers (indexer, ai-worker)

Workers use `NestFactory.createApplicationContext`, not `NestFactory.create`. They do not bind a port. `enableShutdownHooks()` must be called — it registers handlers for SIGTERM/SIGINT and triggers `OnApplicationShutdown` providers. Do not add manual `process.on('SIGTERM', ...)` handlers alongside it (fires teardown twice).

Each provider that owns async resources (pollers, RPC clients) should implement `OnApplicationShutdown` and drain them there. `pgDb.destroy()` is not required — the OS closes sockets cleanly on process exit and Postgres handles abrupt disconnects fine.

## Ops endpoints

Every process that produces metrics exposes a `GET /metrics` endpoint in Prometheus text format:

- All three apps (`apps/api`, `apps/indexer`, `apps/ai-worker`) — served by `OpsServer` from `@nest/observability` on `OPS_PORT` (default 9091). For local dev with multiple workers, set `OPS_PORT=9092` etc. per process.

Each app's `main.ts` sets `OTEL_SERVICE_NAME ??= '<app>'` before the Nest context boots. `OTEL_SERVICE_NAMESPACE` must be provided via environment — `@libs/observability` throws on import if it is unset.

## Kysely migrations

Postgres migration files come from two locations, merged and sorted alphabetically by filename before being applied:

- **Core** — `libs/db/migrations/0NNN_<name>.ts` for schema that belongs to no single source
- **Per-source** — `libs/sources/<source>/migrations-postgres/<source>_NNN_<name>.ts` for source-specific data (e.g. inserting into the `source_type` reference table)

Alphabetical ordering guarantees core migrations (`0NNN_*`) run before source migrations (`<source>_NNN_*`) since `0` < any lowercase letter. Each file exports `up(db)` and `down(db)` using the `sql` tagged-template tag. Run with:

```bash
pnpm -w db:migrate        # apply all pending migrations
pnpm -w db:migrate:down   # roll back the last migration
pnpm -w db:reset          # roll back all migrations (dev only)
```

ClickHouse migration files live at `libs/sources/<source>/migrations-clickhouse/` as plain SQL files (`<source>_NNN_<name>.sql`, e.g. `compound_001_archive.sql`). Run with:

```bash
pnpm -w db:migrate:ch
```

No code generation step. `pnpm install` no longer triggers anything DB-related.

## TypeScript path aliases

Defined in `tsconfig.base.json`. Paths use `./` prefix (required by TS 5.9 without `baseUrl`):

```json
"@libs/domain": ["./libs/domain/src/index.ts"],
"@libs/db":     ["./libs/db/src/index.ts"],
"@libs/chain":  ["./libs/chain/src/index.ts"],
"@libs/ai":     ["./libs/ai/src/index.ts"],
"@libs/utils":  ["./libs/utils/src/index.ts"]
```

## Where things live

```
apps/
  api/           NestJS HTTP API (port 3001)
  dashboard/     Next.js 16 App Router (port 3000)
  indexer/       NestJS standalone — block event consumer
  ai-worker/     NestJS standalone — AI summarisation worker
  admin-cli/  Operator CLI — stub command tree (M0)
libs/
  domain/       Shared domain types and constants
  db/           Kysely clients (pgDb, chDb), PgDatabase/ClickHouseDatabase types, migrations, scripts
  auth/         Framework-agnostic API-key auth primitives (HMAC/bearer/pepper helpers)
  chain/        Chain-interaction helpers (placeholder until M1)
  ai/           AI provider abstractions (placeholder until M5)
  observability/ OTel SDK wiring — MeterProvider, defineCounter/Gauge/Histogram, renderMetrics()
  utils/        Framework-agnostic utilities (sleep, …)
  sources/<source>/
    src/<contract-kind>/  Per-source primitives — ABI/decoder, ArchiveWriter, ingester-listener factory.
                          Framework-agnostic; consumed by apps/indexer Nest module via useFactory.
    migrations-postgres/  Source-specific PG migrations (run by Kysely migrator)
    migrations-clickhouse/ Source-specific CH migrations (plain SQL, run by clickhouse-migrations)
nest/
  observability/ OpsServer provider — GET /metrics on OPS_PORT for all apps
  sources/<source>/  NestJS composition root for a source (DI wiring, useFactory providers)
docs/
  SPEC.md       Frozen v1.0 product spec
  adr/          Architecture Decision Records (ADR-021 onward)
  runbooks/     Operational runbooks
infra/
  scripts/      Provisioning scripts
```

## Known gotchas

- **pnpm 11 `-w` flag**: Use `pnpm -w <script>` when invoking root scripts for explicitness — it makes the target unambiguous regardless of `working-directory:` overrides and stays consistent with CI and Lefthook. Without `-w`, pnpm resolves from cwd, which can produce surprising results in scripts and CI contexts.
- **`"type": "module"` in root `package.json`**: Do not add it. It makes all `.js` files ESM, breaking `require()` in webpack configs (CJS). The ESLint "reparsing" warning is acceptable.
- **Webpack alias resolution**: `apps/api`, `apps/indexer`, `apps/ai-worker` bundle via webpack + ts-loader. Path aliases (`@libs/*`) are resolved via `resolve.alias` in each `webpack.config.js` — update these aliases if you add or rename a lib.
- **lib builds**: `pnpm -r run build` builds libs via `tsc -p tsconfig.lib.json`. The output (`dist/out-tsc/`) is not used by apps (apps bundle from source via webpack). Lib builds exist only to verify compilation.
- **Kysely migration runner exits non-zero on partial failure**: `migrate.ts` checks `result.error` and calls `process.exit(1)`. The default Kysely `Migrator` API does not bubble errors automatically — always check `error` after `migrateToLatest()` / `migrateDown()` in any custom runner code.

## KNOWN-NNN issue registry

Unresolved known issues are tracked as `KNOWN-NNN` references in code comments. When adding a known issue, assign the next available number and add a comment explaining what's known and when it should be resolved. Example: `// KNOWN-001: replace with structured logger in M2`.
