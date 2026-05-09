# Kvorum

**On-chain governance, made legible.** Kvorum indexes DAO proposals and votes from Snapshot and EVM chains, enriches them with AI summaries, and surfaces them through a clean dashboard — giving token holders and researchers a single place to understand what is happening in governance without wading through raw calldata.

Licensed under AGPL-3.0. See [ADR-029](docs/adr/0029-license.md) for why AGPL and what it means for self-hosting.

---

## Quickstart

### Prerequisites

- Node 24 LTS (`nvm install 24 && nvm use 24`)
- pnpm 11 (`corepack enable && corepack prepare pnpm@11.0.8 --activate`)
- Docker (for the local infra stack)

### Install

```bash
git clone https://github.com/EugeneButusov/kvorum.git
cd kvorum
pnpm install        # also runs prisma generate via postinstall
```

### Environment

```bash
cp .env.example .env
# No edits required — defaults work for M0 (anvil runs standalone, no fork URL needed).
```

### Start the stack

```bash
make up       # starts postgres, redis, anvil; waits for all to be healthy
make migrate  # applies pending Prisma migrations
```

### Run the full stack

```bash
# Start all four apps in parallel
npx nx run-many -t serve --parallel=4

# Or individually
npx nx serve api          # http://localhost:3001/health
npx nx serve dashboard    # http://localhost:3000
npx nx serve indexer
npx nx serve ai-worker
```

### Verify

```bash
make ps                             # all three infra services healthy
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
  api/          NestJS HTTP API — REST endpoints (port 3001)
  dashboard/    Next.js 16 App Router — governance dashboard (port 3000)
  indexer/      NestJS standalone worker — block event consumer
  ai-worker/    NestJS standalone worker — AI summarisation

libs/
  domain/       Shared types and constants
  db/           Prisma client wrapper (PrismaService, DbModule)
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

## make targets

| Target             | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `make help`        | List all targets                                     |
| `make doctor`      | Check prerequisites and infra port health            |
| `make up`          | Start postgres, redis, anvil (waits for healthy)     |
| `make down`        | Stop infra services                                  |
| `make migrate`     | Apply pending Prisma migrations                      |
| `make migrate-dev` | Create and apply a new dev migration                 |
| `make reset`       | Wipe volumes and re-migrate (requires `CONFIRM=yes`) |
| `make dev`         | `up` + `migrate` + serve all apps                    |
| `make logs`        | Tail logs (`SERVICE=postgres` for one service)       |
| `make ps`          | Show service status                                  |
| `make test`        | Run all tests (`PROJECT=api` to scope)               |
| `make clean`       | Remove `node_modules`, `.nx`, `dist`, `.next`        |

---

## Contributing

1. Branch from `main` using the milestone prefix: `feat/m1-…`, `fix/…`, `chore/…`.
2. All four checks must pass before pushing (`pnpm -w format:check && pnpm -w lint && pnpm -w typecheck && pnpm -w test`). Lefthook enforces formatting at commit and typecheck+test at push.
3. Follow the ORM-first database convention (see `CLAUDE.md`).
4. PRs should close the relevant GitHub issue.

Supported platforms: macOS, Linux, WSL. Native Windows is not supported.

---

## Troubleshooting

| Symptom                                              | Likely cause                        | Fix                                                      |
| ---------------------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `pnpm install` fails with "Unsupported engine"       | Node version < 24                   | `nvm use 24`                                             |
| `pnpm <script>` fails with "No packages found"       | Missing `-w` flag                   | `pnpm -w <script>`                                       |
| `@kvorum/db` import unresolved                       | Prisma client not generated         | `pnpm -w db:generate`                                    |
| `make up` fails or times out                         | Port conflict or Docker not running | `make doctor` to diagnose                                |
| Port 5432/6379/8545 already in use                   | Another container or local service  | `docker ps` and stop the conflict                        |
| Nx generator creates files under `libs/domain/apps/` | Nx path resolution bug              | Move with `cp -r`, fix `../..` depths, clear `.nx/cache` |
| `"type": "module"` breaks webpack                    | Do not add to root `package.json`   | Remove it                                                |
| Lefthook blocks commit with format error             | Unstaged Prettier fix               | `pnpm -w format` and re-stage                            |

---

## License

AGPL-3.0 — see [LICENSE](LICENSE) and [ADR-029](docs/adr/0029-license.md).

Self-hosting is permitted. If you run a modified version as a network service, AGPL requires you to offer your users access to the modified source under the same license.
