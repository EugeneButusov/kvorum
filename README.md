# Kvorum

**On-chain governance, made legible.** Kvorum indexes DAO proposals and votes from Snapshot and EVM chains, enriches them with AI summaries, and surfaces them through a clean dashboard — giving token holders and researchers a single place to understand what is happening in governance without wading through raw calldata.

Licensed under AGPL-3.0. See [ADR-029](docs/adr/0029-license.md) for why AGPL and what it means for self-hosting.

---

## Quickstart

### Prerequisites

- Node 24 LTS (`nvm install 24 && nvm use 24`)
- pnpm 11 (`corepack enable && corepack prepare pnpm@11.0.8 --activate`)
- Docker (for the local Postgres instance)

### Install

```bash
git clone https://github.com/EugeneButusov/kvorum.git
cd kvorum
pnpm install        # also runs prisma generate via postinstall
```

### Environment

Copy the example file and fill in values:

```bash
cp .env.example .env
```

Minimum required for local dev:

```env
DATABASE_URL=postgresql://postgres:dev@localhost:5432/kvorum?schema=public&connection_limit=5&pool_timeout=10
API_PORT=3001
```

> **Note — `ANVIL_FORK_URL`**: the RPC fork URL used by Anvil for local chain simulation lands in Epic B1. Document it in `.env.example` now so contributors know it's coming; leave it blank until B1 is merged.

### Start the database

```bash
docker run -d --name kvorum-dev-postgres \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=dev \
  postgres:18-alpine

pnpm -w db:migrate:dev --name init
```

### Run the full stack

> **Note**: the `make` commands documented in the full SPEC arrive in Epic B1 (Docker Compose + Makefile). Use `nx` directly until then.

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
  runbooks/     Operational runbooks (secrets, rotation, etc.)

infra/
  scripts/      Provisioning scripts
```

---

## Contributing

1. Branch from `main` using the milestone prefix: `feat/m1-…`, `fix/…`, `chore/…`.
2. All four checks must pass before pushing (`pnpm -w format:check && pnpm -w lint && pnpm -w typecheck && pnpm -w test`). Lefthook enforces formatting at commit and typecheck+test at push.
3. Follow the ORM-first database convention (see `CLAUDE.md`).
4. PRs should close the relevant GitHub issue.

---

## Troubleshooting

| Symptom                                              | Likely cause                      | Fix                                                      |
| ---------------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| `pnpm install` fails with "Unsupported engine"       | Node version < 24                 | `nvm use 24`                                             |
| `pnpm <script>` fails with "No packages found"       | Missing `-w` flag                 | `pnpm -w <script>`                                       |
| `@kvorum/db` import unresolved                       | Prisma client not generated       | `pnpm -w db:generate`                                    |
| Port 5432 already in use                             | Another Postgres container        | `docker ps` and stop the conflict                        |
| Nx generator creates files under `libs/domain/apps/` | Nx path resolution bug            | Move with `cp -r`, fix `../..` depths, clear `.nx/cache` |
| `"type": "module"` breaks webpack                    | Do not add to root `package.json` | Remove it                                                |
| Lefthook blocks commit with format error             | Unstaged Prettier fix             | `pnpm -w format` and re-stage                            |

---

## License

AGPL-3.0 — see [LICENSE](LICENSE) and [ADR-029](docs/adr/0029-license.md).

Self-hosting is permitted. If you run a modified version as a network service, AGPL requires you to offer your users access to the modified source under the same license.
