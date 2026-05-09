# CLAUDE.md — Kvorum

Guidance for Claude Code working in this repo.

## Stack snapshot (M0)

| Layer                      | Choice                       | Notes                                                          |
| -------------------------- | ---------------------------- | -------------------------------------------------------------- |
| Runtime                    | Node 24 LTS                  | `.nvmrc` pins the minor                                        |
| Package manager            | pnpm 11                      | workspace monorepo; use `-w` for root scripts                  |
| Build orchestration        | Nx 22                        | integrated mode, no Nx Cloud                                   |
| API                        | NestJS 11                    | `apps/api` — HTTP + REST                                       |
| Workers                    | NestJS 11 standalone context | `apps/indexer`, `apps/ai-worker` — no HTTP                     |
| Dashboard                  | Next.js 16 App Router        | `apps/dashboard`, Turbopack dev                                |
| Database                   | PostgreSQL 18                | Prisma 6 ORM                                                   |
| Prisma generator           | `prisma-client`              | NOT the deprecated `prisma-client-js`                          |
| Testing (libs + dashboard) | Vitest 4                     |                                                                |
| Testing (NestJS apps)      | Jest 30                      | Nx 22 `@nx/nest` only supports jest                            |
| Language                   | TypeScript 5.7               | strict + noUncheckedIndexedAccess                              |
| Linting                    | ESLint 9 flat config         | `@nx/enforce-module-boundaries` active                         |
| Formatting                 | Prettier 3                   | enforced in pre-commit via Lefthook                            |
| Git hooks                  | Lefthook                     | pre-commit: format + prisma format; pre-push: typecheck + test |

ClickHouse is deferred (ADR-026). Do not add ClickHouse dependencies.

## Module boundaries (Nx tags)

| Tag            | Libs          | Can depend on  |
| -------------- | ------------- | -------------- |
| `scope:domain` | `libs/domain` | nothing        |
| `scope:db`     | `libs/db`     | `scope:domain` |
| `scope:chain`  | `libs/chain`  | `scope:domain` |
| `scope:ai`     | `libs/ai`     | `scope:domain` |
| `scope:app`    | `apps/*`      | any lib        |

The `@nx/enforce-module-boundaries` rule in `eslint.config.js` enforces these. Don't add cross-lib dependencies without updating the constraint table.

## Database access convention

Use Prisma ORM methods (`prisma.model.findMany(...)`) by default. Use `$queryRaw` / `$executeRaw` only when the ORM genuinely cannot express the operation (e.g., `pg_notify`, recursive CTEs, `ON CONFLICT DO UPDATE` returning multiple rows). Document the reason when reaching for raw SQL.

## Pre-commit checks

Every commit must pass all four checks before pushing:

```bash
pnpm -w format:check
pnpm -w lint
pnpm -w typecheck
pnpm -w test
```

Lefthook enforces formatting + prisma format on staged files at `git commit`. Typecheck + test run at `git push`. Do not use `--no-verify`.

## NestJS workers (indexer, ai-worker)

Workers use `NestFactory.createApplicationContext`, not `NestFactory.create`. They do not bind a port. `enableShutdownHooks()` must be called — it registers handlers for SIGTERM/SIGINT and triggers `OnApplicationShutdown` providers. Do not add manual `process.on('SIGTERM', ...)` handlers alongside it (fires teardown twice).

`PrismaService` implements `OnModuleDestroy` — it disconnects the connection pool on shutdown. This is load-bearing for clean exit.

## Prisma

Schema lives at `libs/db/prisma/schema.prisma`. Generated client goes to `libs/db/src/generated` (gitignored). Regenerate with:

```bash
pnpm -w db:generate
```

Or it fires automatically via `nx.json` `targetDefaults` `dependsOn: ["db:generate"]` before build/typecheck/test. The `postinstall` script in `package.json` also runs it on `pnpm install`.

For migrations:

```bash
pnpm -w db:migrate:dev   # dev: creates migration file
pnpm -w db:migrate       # prod: applies pending
```

## TypeScript path aliases

Defined in `tsconfig.base.json`. Paths use `./` prefix (required by TS 5.9 without `baseUrl`):

```json
"@kvorum/domain": ["./libs/domain/src/index.ts"],
"@kvorum/db":     ["./libs/db/src/index.ts"],
"@kvorum/chain":  ["./libs/chain/src/index.ts"],
"@kvorum/ai":     ["./libs/ai/src/index.ts"]
```

## Where things live

```
apps/
  api/          NestJS HTTP API (port 3001)
  dashboard/    Next.js 16 App Router (port 3000)
  indexer/      NestJS standalone — block event consumer
  ai-worker/    NestJS standalone — AI summarisation worker
libs/
  domain/       Shared domain types and constants
  db/           Prisma client, PrismaService, DbModule
  chain/        Chain-interaction helpers (placeholder until M1)
  ai/           AI provider abstractions (placeholder until M5)
docs/
  SPEC.md       Frozen v1.0 product spec
  adr/          Architecture Decision Records (ADR-021 onward)
  runbooks/     Operational runbooks
infra/
  scripts/      Provisioning scripts
```

## Known gotchas

- **Nx generator path bug**: `@nx/nest:application` and `@nx/next:application` generators sometimes resolve `--directory` relative to the first lib project instead of the workspace root. If generated files appear under `libs/domain/apps/`, move them with `cp -r` and fix `../../` → correct relative depth. Clear Nx cache after: `rm -rf .nx/cache .nx/workspace-data`.
- **pnpm 11 `-w` flag**: Use `pnpm -w <script>` when invoking root scripts for explicitness — it makes the target unambiguous regardless of `working-directory:` overrides and stays consistent with CI and Lefthook. Without `-w`, pnpm resolves from cwd, which can produce surprising results in scripts and CI contexts.
- **`"type": "module"` in root `package.json`**: Do not add it. It makes all `.js` files ESM, breaking `require()` in webpack configs and Jest preset files that are CJS. The ESLint "reparsing" warning is acceptable.
- **Prisma 7 breaking change**: Prisma 7 removed the `url` property from datasource in `schema.prisma` (moved to `prisma.config.ts`). This project pins Prisma 6.19.3. Do not upgrade without reading the Prisma 7 migration guide.

## KNOWN-NNN issue registry

Unresolved known issues are tracked as `KNOWN-NNN` references in code comments. When adding a known issue, assign the next available number and add a comment explaining what's known and when it should be resolved. Example: `// KNOWN-001: replace with structured logger in M2`.
