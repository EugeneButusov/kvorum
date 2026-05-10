# Contributing to Kvorum

## Prerequisites

- Node 24 LTS (`nvm install 24 && nvm use 24`) — `.nvmrc` pins the major
- pnpm 11 (`corepack enable && corepack prepare pnpm@11.0.8 --activate`)
- Docker (for the local infra stack)
- just (`brew install just` on macOS, or see [just.systems](https://just.systems/man/en/packages.html))

Supported platforms: macOS, Linux, WSL. Native Windows is not supported.

## Getting started

```bash
pnpm install
cp .env.example .env
just up             # starts postgres, redis, anvil, clickhouse; waits for healthy
just migrate        # applies pending Kysely migrations (Postgres + ClickHouse)
```

See the [README](README.md) for how to run individual apps and the full list of `just` recipes.

## Spec and ADR lifecycle

**`docs/SPEC.md` is frozen at v1.0.** It is the implementation contract and is not edited after freeze. If you need to change what Kvorum does or how it works:

1. Write a numbered ADR in `docs/adr/`. Numbering continues from the v1.0 DRs (DR-001 through DR-020), so the first post-freeze ADR is ADR-021. Use the next free number — see [`docs/adr/README.md`](docs/adr/README.md) for the index.
2. The ADR records context, the decision, alternatives considered, and consequences, and lists which spec sections it amends.
3. Reference the ADR number in commit messages and PRs.

Template (matches the format of existing ADRs):

```markdown
# ADR-NNNN — <title>

- **Status**: Proposed | Accepted | Superseded by ADR-NNN | Deprecated
- **Date**: YYYY-MM-DD
- **Spec sections affected**: §X.Y, §X.Z
- **Related**: ADR-NNN, #issue, DR-NNN

## Context

Why this decision is needed.

## Decision

What we decided.

## Alternatives considered

What else was on the table and why it was rejected.

## Consequences

What changes, what tradeoffs are accepted.
```

Reading `docs/SPEC.md` plus the ADRs in order gives the current canonical design.

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <short description in imperative mood>

[optional body]

[optional footer: Co-Authored-By, Fixes #issue]
```

**Types:** `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `perf`, `ci`

**Scopes (apps and libs):** `api`, `dashboard`, `indexer`, `ai-worker`, `admin`, `db`, `domain`, `chain`, `ai`

**Other scopes:** `adr`, `infra`, `ci`, `deps`, `security`

During early milestones, an epic-tag scope is also acceptable (e.g., `c1`, `c2`, `d3`) when work is being delivered against a specific epic checkpoint. Prefer the app/lib scope once the change has a clear home.

The description must be ≤ 72 characters, imperative mood ("add endpoint", not "added endpoint").

```
feat(admin): add user create and user update subcommands (ADR-036)
fix(indexer): handle empty log array during reorg detection
docs(adr): ADR-036 extend kvorum-admin user with create and update subcommands
chore(deps): upgrade kysely to 0.29.0
ci: add pull-requests read permission for gitleaks-action
```

## Branch naming

```
feat/<short-slug>
fix/<short-slug>
test/<short-slug>
chore/<short-slug>
docs/<short-slug>
```

Branches that target a specific milestone or epic may include the prefix in the slug, e.g. `feat/m1-…` or `feat/d3-user-create-update`. Work in progress: prefix with `wip/`. WIP branches are not reviewed until the prefix is removed.

## Pull requests

- One logical change per PR. If a PR touches unrelated things, split it.
- Fill in the PR description: what changed, why, and how to test it.
- All four pre-commit checks must pass locally and in CI before merge:
  ```bash
  pnpm -w format:check
  pnpm -w lint
  pnpm -w typecheck
  pnpm -w test
  ```
- PRs that change the database schema must include the migration file(s) under `libs/db/migrations/` (Postgres) or `libs/sources/*/migrations-clickhouse/` (ClickHouse).
- If your change is driven by an ADR, link the ADR in the PR description.
- Operator-side branch protection setup is documented in [`docs/runbooks/branch-protection.md`](docs/runbooks/branch-protection.md).

## Testing

The project uses two test frameworks, depending on what's being tested:

- **Vitest 4** for libs (`libs/*`) and the Next.js dashboard (`apps/dashboard`).
- **Jest 30** for NestJS apps (`apps/api`, `apps/indexer`, `apps/ai-worker`, `apps/kvorum-admin`).

Run everything from the repo root:

```bash
pnpm -w typecheck
pnpm -w test
```

Or scope to a single workspace:

```bash
pnpm --filter @libs/db test
pnpm --filter api test
```

**Conventions:**

- Database access uses the Kysely query builder by default (see [CLAUDE.md](CLAUDE.md)). Reach for the `sql` tagged-template helper only when the builder genuinely cannot express the operation (e.g., `pg_notify`, recursive CTEs, partial unique indexes).
- Every new NestJS controller or service method needs at least one unit test.

## Database schema changes

### Postgres

1. Create a new migration file at `libs/db/migrations/<NNNN>_<name>.ts` exporting `up(db)` and `down(db)` functions using the `sql` tagged-template helper.
2. `pnpm -w db:migrate` — applies all pending migrations.
3. To roll back the last migration locally: `pnpm -w db:migrate:down`.
4. Commit the migration file.

### ClickHouse

1. Create a new `.sql` file at `libs/sources/<source>/migrations-clickhouse/<source>_NNN_<name>.sql`.
2. `pnpm -w db:migrate:ch` — applies all pending ClickHouse migrations.
3. Commit the migration file.

Never edit a migration file that has already been applied in any deployed environment.

## Adding a new DAO (post-v1)

Per SPEC.md §2.2, the model is designed so new DAOs require minimal changes. Source-adapter scaffolding lands in M1; until then this section is forward-looking:

1. Write an ADR documenting the new source type and any new extension tables needed.
2. Add the `source_type` enum value and extension table(s) via a new Kysely migration in `libs/db/migrations/` and the corresponding schema type in `libs/sources/<name>/src/schema/`.
3. Implement a source adapter in `apps/indexer/src/sources/`.
4. Add the DAO + source seed rows.
5. Update `docs/SPEC.md` via ADR only — do not edit the spec directly.

## Code style

Prettier and ESLint are enforced at commit time by Lefthook and in CI:

```bash
pnpm -w format         # auto-fix formatting
pnpm -w lint           # report lint errors
```

Key rules:

- No `any` without a comment explaining why it cannot be avoided.
- No double type-casting (`as unknown as T`). If you need to cast, fix the type signature instead. In tests, prefer typed factory functions or properly-typed mocks over casting past the compiler.
- No `console.log` in service code outside the M0 bootstrap path. A structured pino-based logger is planned for M2 — see `KNOWN-001` in [CLAUDE.md](CLAUDE.md). Once it lands, use structured log fields rather than string interpolation: `logger.info({ proposalId }, 'indexed')`.

The repo follows standard NestJS / TypeScript conventions:

- File names: kebab-case with role suffix (`health.controller.ts`, `app.module.ts`).
- Class names: PascalCase, no prefix (`HealthController`, `AppModule`).
- Tests sit next to the source file as `*.spec.ts`.

## Pre-commit hooks

Lefthook runs Prettier and `pnpm -w typecheck` on staged files at `git commit` time. There is no pre-push block — `lint` and `test` must be run manually before pushing (CI will catch what slips through).

Do not bypass hooks with `--no-verify`.

## License

By contributing, you agree that your contributions will be licensed under [AGPL-3.0](LICENSE) (see [ADR-029](docs/adr/0029-license.md)). Documentation contributions are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
