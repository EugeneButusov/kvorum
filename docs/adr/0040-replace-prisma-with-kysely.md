# ADR-040 — Replace Prisma with Kysely; ClickHouse migrations via `clickhouse-migrations` npm

- **Status**: Accepted (2026-05-10)
- **Date**: 2026-05-10
- **Spec sections affected**: 7.6, 10.2
- **Related**: ADR-038 (archive layer in CH from M1), `docs/proposal-orm-choice.md` v2, `docs/proposal-source-package-boundary.md`, `docs/plan-m1-e1.md` v4

## Context

SPEC §7.6 (security) states:

> SQL queries use parameterized statements throughout (Prisma's default). No raw query interpolation.

SPEC §10.2 (M0 milestone) lists as an acceptance criterion:

> Prisma initialized with empty schema; first migration runs.

M0 in fact landed Prisma 6.19.3 with the new `prisma-client` generator (not the deprecated `prisma-client-js`) and a no-op baseline migration at `libs/db/prisma/migrations/20260508215412_init/migration.sql`. CLAUDE.md's "Stack snapshot (M0)" row reflects Prisma as the chosen ORM. No schema models or production code yet depend on Prisma's runtime API — the Prisma scaffolding is a tooling commitment, not a working data layer.

E1 is the first milestone where this commitment is exercised. Three pressures, identified during E1 planning, push toward revisiting the choice now while the cost of switching is small (re-author M1's schema in the new tool; no working code to rewrite):

1. **ADR-038 commits to dual-DB from M1.** Postgres for the OLTP control plane (proposals, votes, archive_event, DLQ, auth) and ClickHouse for the raw event archive layer. Prisma does not support ClickHouse — neither natively nor via stable community drivers. With Prisma, dual-DB means two distinct query libraries in F1 and G1 hot paths (Prisma for Postgres, `@clickhouse/client` raw for ClickHouse), with no shared call-site idiom.

2. **Source-package boundary friction.** The architectural goal (per `docs/proposal-source-package-boundary.md`) is for Compound-specific schema to live in `libs/sources/compound/`, not `libs/db/`. With Prisma this requires either the `prismaSchemaFolder` preview feature plus a custom assemble script that gathers `*.prisma` files across the workspace, or a flat `libs/db/prisma/schema/` with naming-convention-only separation. Both options carry preview-feature risk or convention-only enforcement.

3. **Hand-edited Postgres migrations.** Several M1 schema constraints (partial unique index on `archive_event` for canonical rows, `CHECK (address = lower(address))` on `abi_cache`, the `CHECK (length(trim(reason)) > 0)` on `ingestion_dlq_resolved.reason` per ADR-032) are not expressible in Prisma's DSL and must be appended to generated SQL by hand — Prisma does not regenerate these on subsequent migrations. The hand-edit pattern is fragile (lost on regenerate, hard to review).

The combination flips the cost-benefit. Prisma's strengths (best-in-class nested relational reads, generated client with rich types, mature tooling) buy us less when we're paying a dual-DB tax on every F/G hot path and a preview-feature tax on every source-package boundary.

## Decision

**Replace Prisma with Kysely as the data-access layer for v1.**

Concretely:

- **Postgres queries:** Kysely query builder. The `Database` interface lives in `libs/db/src/schema/` (TS types) and source-specific tables compose into it via barrel re-export from `libs/sources/<name>/src/schema/`.
- **Postgres migrations:** Kysely's built-in `Migrator` class (ships with Kysely; no extra package). Migration files are TS modules with `up(db)` / `down(db)` async functions. Bodies use the `sql\`...\``template tag for raw SQL where needed (CHECK, partial unique, custom indexes); Kysely DSL where it reads cleanly. Migration tracking via the auto-managed`kysely_migration`table. Runner:`libs/db/scripts/migrate.ts`constructs a`Migrator`with`FileMigrationProvider`and exposes`migrateToLatest()`/`migrateDown()`via`pnpm -w db:migrate` and friends.
- **ClickHouse queries:** Kysely with the community `kysely-clickhouse` dialect. Same call-site idiom as Postgres queries. Two `Kysely<...>` instances (`pgDb`, `chDb`) over different `Dialect` configs; one shared query API.
- **ClickHouse migrations:** `clickhouse-migrations` npm package (by `vladdoster`). Pure `*.sql` files in lexical order, idempotency tracked in a `_migrations` CH table. Files live per-package (e.g., `libs/sources/compound/migrations-clickhouse/`) following source-package Option B.

### SPEC §7.6 invariant preserved

The §7.6 phrase "(Prisma's default)" is **incidental detail**, not a normative requirement. The normative invariant is "SQL queries use parameterized statements throughout. No raw query interpolation." Kysely satisfies this:

- Kysely's query builder always parameterizes (positional `$1, $2, ...` placeholders for Postgres, `?` for ClickHouse).
- The `sql\`...\``template tag also parameterizes via tagged-template interpolation: any value spliced via`${...}`becomes a parameter, never a raw string concatenation. Raw SQL fragments (table names, column names, schema identifiers) require explicit`sql.id(...)`/`sql.lit(...)`/`sql.raw(...)` opt-in helpers, which are auditable in code review.
- The `clickhouse-migrations` package executes file contents verbatim against `clickhouse-client`; migration files contain DDL only (no user input), so the parameterization concern doesn't apply.

The security guarantee §7.6 cares about — SQL injection cannot occur via user input — is intact under Kysely.

### SPEC §10.2 M0 milestone

The "Prisma initialized with empty schema" milestone was met by M0 as documented. PR 0 of E1 swaps Prisma for Kysely:

- Drop `libs/db/prisma/` directory (including the no-op baseline migration).
- Drop Prisma packages from root `package.json` devDependencies.
- Add `kysely`, `pg`, `@clickhouse/client`, `kysely-clickhouse`, `clickhouse-migrations` to root devDependencies.
- Update CLAUDE.md "Stack snapshot (M0)" row.

After PR 0 lands, the M0 milestone is technically still met (initial DB scaffolding ran, an empty migration applied), just with a different tool. PR 0's commit message and PR description explicitly reference this ADR as the rationale.

### Source-package boundary

This ADR ratifies Option B from `docs/proposal-source-package-boundary.md` (per-package schema files, possible only because Kysely's TS-module composition makes it free):

- `libs/db/src/schema/` — core Postgres `Database` fragments (auth, domain, shared ingestion).
- `libs/sources/compound/src/schema/` — Compound's Postgres + ClickHouse schema fragments.
- `libs/db/src/schema/index.ts` (barrel) — re-exports from both, producing the composed `PgDatabase` and `ClickHouseDatabase` types.
- Future `libs/sources/aave/`, `libs/sources/aragon/`, etc. follow the same pattern.

## Alternatives considered

- **Stay on Prisma 6.** Pays the preview-feature tax on `prismaSchemaFolder` (or accepts naming-convention-only separation), pays the assemble-script complexity for source-package boundaries, requires a second tool for ClickHouse from M1. Doesn't solve the dual-query-idiom problem in F1/G1. The mature ecosystem and best-in-class nested relational reads don't compensate for these costs at v1's query shape (mostly one-level reads).
- **Drizzle.** Better Postgres ergonomics than Kysely for OLTP CRUD, native multi-package schema (no preview features). But doesn't support ClickHouse — same dual-tool problem as Prisma. Recommended in `proposal-orm-choice.md` v1; flipped to Kysely in v2 after ADR-038 made dual-DB an M1 requirement.
- **Multi-client Prisma + raw `@clickhouse/client`.** Two query idioms forever. Maximally fragments F1/G1 hot paths.
- **Raw `pg` + custom layer + `@clickhouse/client` directly.** Total control, total responsibility. Meaningful boilerplate for 16 Postgres tables; gives up the type-safety win that's the main reason to use a query builder at all.
- **TypeORM, MikroORM, Sequelize.** Decorator-heavy, losing mindshare to Kysely / Drizzle in 2026, no ClickHouse story. Skip.

See `docs/proposal-orm-choice.md` v2 for the full comparison matrix.

## Consequences

- **PR 0 of E1 swaps Prisma for Kysely.** Estimated ~2h: drops Prisma scaffolding, adds Kysely dependencies, wires `pnpm -w db:migrate` to the new runner, updates CLAUDE.md and `docker-compose.yml` (the latter also adds ClickHouse per ADR-038).
- **`docs/plan-m1-e1.md` v3** is already aligned with this ADR. Schema sections describe SQL-native column types, Foreign Keys section uses Postgres `ON DELETE` syntax, indexes are declared as `CREATE INDEX` / `CREATE UNIQUE INDEX` rather than Prisma `@@index`/`@@unique` directives.
- **CLAUDE.md updates land in PR 0:**
  - "Stack snapshot (M0)" ORM row: "Prisma 6 (with `prisma-client` generator)" → "Kysely (queries on Postgres + ClickHouse via `kysely-clickhouse`); built-in Migrator for Postgres; `clickhouse-migrations` npm for CH."
  - "Database access convention" section: "Use Prisma ORM methods (`prisma.model.findMany(...)`) by default..." → "Use the Kysely query builder (`db.selectFrom(...).where(...).execute()`) by default; reach for `sql\`...\``template tag only when the builder genuinely cannot express the operation (recursive CTEs,`pg_notify`, ClickHouse-specific engine DDL). Tagged-template interpolation parameterizes — raw concatenation is never permitted."
  - Module boundaries table: unchanged.
  - Pre-commit hooks: drop `prisma format`; add migration-file lint (`sqlfluff` or equivalent on staged `*.sql` and embedded `sql\`...\`` blocks).
- **Existing ADRs referencing Prisma idioms.** None of ADR-021 through ADR-037 reference Prisma APIs. ADR-022 mentions `Decimal` (now `numeric(78,0)` in SQL); ADR-025 mentions HMAC-SHA256 (unaffected); ADR-027 references `dao_source.backfill_started_at_block` as a column (column-level, tool-agnostic); ADR-032 mentions DLQ tables (column-level); ADR-036 references the `User` table by name (column-level, no Prisma APIs). No cascade rewrites needed.
- **Auto-memory feedback `feedback_orm_first.md`** (per the user's CLAUDE.md memory) currently reads: "use Prisma ORM methods by default; `$queryRaw` / `$executeRaw` only when ORM genuinely can't do it." Update to: "use Kysely query builder methods by default; `sql\`...\`` template tag only when the builder genuinely can't express the operation." The underlying principle (prefer the typed query API; reach for raw SQL only when needed) is unchanged.
- **Pre-1.0 risk.** Kysely is at version 0.27 (stable API, used in production at companies like Vercel, but not 1.0). Mitigation: pin exact version in root `package.json`; review changelog at any upgrade.
- **`clickhouse-migrations` npm package risk.** One-person-maintained. Mitigation: migration files are pure SQL — survive any tool swap. If the package goes stale, fallback is a hand-rolled runner against `@clickhouse/client` plus a `_migrations` table. Files don't change.
- **No schema or API contract change.** This ADR only changes the tooling that produces and consumes the schema. Tables, columns, indexes, FKs are unchanged from `plan-m1-e1.md` v3.

## Implementation notes (M1-specific)

- **PR 0 (`chore/swap-prisma-for-kysely`)** is the gating PR; PR 1 (auth/admin) and PR 2 (ingestion + domain + Compound) stack on it. Estimated ~2h.
- **Migration file naming:** `0001_<description>.ts` (Kysely PG migrations), `0001_<description>.sql` (CH migrations). Lexical ordering matters for the file-based provider.
- **Test ergonomics:** `Migrator` is invoked from Vitest tests against an ephemeral Postgres + CH (Docker Compose containers spun up per test run). The smoke test in `libs/db/src/lib/db.spec.ts` exercises one row of every M1 PG table; `libs/sources/compound/src/lib/archive.spec.ts` exercises the CH ↔ PG tuple link.
- **Connection pool:** Postgres via `pg.Pool`, ClickHouse via `@clickhouse/client`'s built-in pooling. Both wrapped in Kysely `Dialect` configs in `libs/db/src/client.ts`. Pool size, statement timeout, etc. configured per environment via env vars.
- **Decimal handling:** `numeric(78,0)` for `value_wei` returns as `string` natively from Kysely (no Prisma `Decimal` ↔ `decimal.js` indirection). The H §4.7 wire-format serializer is a passthrough for these columns.
- **Bytes handling:** `bytea` for `api_key.key_hash` returns as `Uint8Array` from `pg`; Kysely passes through. The auth path that hashes a presented key and compares against the column uses `Buffer.compare` (constant-time-equivalent through Node's underlying memcmp).
