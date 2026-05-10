# Kvorum

[![CI](https://github.com/EugeneButusov/kvorum/actions/workflows/ci.yml/badge.svg)](https://github.com/EugeneButusov/kvorum/actions/workflows/ci.yml)

**On-chain governance, made legible.** Kvorum indexes DAO proposals and votes from Snapshot and EVM chains, enriches them with AI summaries, and surfaces them through a clean dashboard — giving token holders and researchers a single place to understand what is happening in governance without wading through raw calldata.

Licensed under AGPL-3.0. See [ADR-029](docs/adr/0029-license.md) for why AGPL and what it means for self-hosting.

---

## Quickstart

### Prerequisites

- Node 24 LTS (`nvm install 24 && nvm use 24`)
- pnpm 11 (`corepack enable && corepack prepare pnpm@11.0.8 --activate`)
- Docker (for the local infra stack)
- just (`brew install just` on macOS, or see [just.systems](https://just.systems/man/en/packages.html))

### Install

```bash
git clone https://github.com/EugeneButusov/kvorum.git
cd kvorum
pnpm install
```

### Environment

```bash
cp .env.example .env
# No edits required — defaults work for M0 (anvil runs standalone, no fork URL needed).
```

### Start the stack

```bash
just up       # starts postgres, redis, anvil, clickhouse; waits for all to be healthy
just migrate  # applies pending Kysely migrations (Postgres + ClickHouse)
```

### Run the full stack

```bash
# Start all apps (each in its own terminal, or use just dev)
pnpm --filter api build:dev && node dist/apps/api/main.js     # http://localhost:3001/health
pnpm --filter dashboard dev                                   # http://localhost:3000
pnpm --filter indexer build:dev && node dist/apps/indexer/main.js
pnpm --filter ai-worker build:dev && node dist/apps/ai-worker/main.js
```

### Verify

```bash
just ps                             # all three infra services healthy
curl http://localhost:3001/health   # {"status":"ok","timestamp":"..."}
curl http://localhost:3000          # HTML containing "governance"
```

### Checks

```bash
pnpm -w format:check
pnpm -w lint
pnpm -w typecheck
pnpm -w test
```

---

## Project structure

```
apps/
  api/           NestJS HTTP API — REST endpoints (port 3001)
  dashboard/     Next.js 16 App Router — governance dashboard (port 3000)
  indexer/       NestJS standalone worker — block event consumer
  ai-worker/     NestJS standalone worker — AI summarisation
  kvorum-admin/  Admin CLI — operator command surface (M0 stubs)

libs/
  domain/       Shared types and constants
  db/           Kysely clients (pgDb, chDb), schema types, migrations
  chain/        Chain-interaction helpers
  ai/           AI provider abstractions

docs/
  SPEC.md       Frozen v1.0 product specification
  adr/          Architecture Decision Records
  runbooks/     Operational runbooks

infra/
  caddy/        Caddy reverse-proxy config (production + dev overlay)
  scripts/      Provisioning scripts
```

---

## just recipes

| Recipe                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `just`                | List all recipes                                 |
| `just doctor`         | Check prerequisites and infra port health        |
| `just up`             | Start postgres, redis, anvil (waits for healthy) |
| `just down`           | Stop infra services                              |
| `just migrate`        | Apply pending Kysely migrations (PG + CH)        |
| `just migrate-dev`    | Roll back one migration (dev)                    |
| `just reset yes`      | Wipe volumes and re-migrate                      |
| `just dev`            | `up` + `migrate` + serve all apps                |
| `just logs [service]` | Tail logs (omit service name for all)            |
| `just ps`             | Show service status                              |
| `just test [project]` | Run all tests (pass project name to scope)       |
| `just clean`          | Remove `node_modules`, `dist`, `.next`           |

---

## Contributing

1. Branch from `main` using the milestone prefix: `feat/m1-…`, `fix/…`, `chore/…`.
2. All four checks must pass before pushing (`pnpm -w format:check && pnpm -w lint && pnpm -w typecheck && pnpm -w test`). Lefthook enforces formatting at commit and typecheck+test at push.
3. Follow the query-builder-first database convention (see `CLAUDE.md`).
4. PRs should close the relevant GitHub issue.
5. Operator branch protection setup: see [`docs/runbooks/branch-protection.md`](docs/runbooks/branch-protection.md).

Supported platforms: macOS, Linux, WSL. Native Windows is not supported.

---

## Troubleshooting

| Symptom                                           | Likely cause                          | Fix                                                       |
| ------------------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `pnpm install` fails with "Unsupported engine"    | Node version < 24                     | `nvm use 24`                                              |
| Root script behaves unexpectedly in CI or scripts | `pnpm` resolves from cwd without `-w` | Use `pnpm -w <script>` for explicitness at workspace root |
| `@libs/db` import unresolved                      | Missing `kysely` package              | `pnpm install`                                            |
| `just up` fails or times out                      | Port conflict or Docker not running   | `just doctor` to diagnose                                 |
| Port 5432/6379/8545 already in use                | Another container or local service    | `docker ps` and stop the conflict                         |
| `"type": "module"` breaks webpack                 | Do not add to root `package.json`     | Remove it                                                 |
| Lefthook blocks commit with format error          | Unstaged Prettier fix                 | `pnpm -w format` and re-stage                             |

---

## License

AGPL-3.0 — see [LICENSE](LICENSE) and [ADR-029](docs/adr/0029-license.md).

Self-hosting is permitted. If you run a modified version as a network service, AGPL requires you to offer your users access to the modified source under the same license.
