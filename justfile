set dotenv-load

compose := "docker compose"
pnpm    := "pnpm -w"

# Show available recipes
default:
    @just --list

# Install node dependencies
install:
    {{ pnpm }} install

# Check prerequisites and infra port health
doctor:
    #!/usr/bin/env bash
    set -euo pipefail
    PASS=true
    echo "prerequisites:"
    if command -v node >/dev/null 2>&1; then
        NODE_VER=$(node --version | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
        if [ "$NODE_MAJOR" -ge 24 ]; then
            echo "  [ok] node $NODE_VER"
        else
            echo "  [FAIL] node $NODE_VER (need >= 24)"; PASS=false
        fi
    else
        echo "  [FAIL] node not found"; PASS=false
    fi
    if command -v pnpm >/dev/null 2>&1; then
        PNPM_VER=$(pnpm --version)
        PNPM_MAJOR=$(echo "$PNPM_VER" | cut -d. -f1)
        if [ "$PNPM_MAJOR" -ge 11 ]; then
            echo "  [ok] pnpm $PNPM_VER"
        else
            echo "  [FAIL] pnpm $PNPM_VER (need >= 11)"; PASS=false
        fi
    else
        echo "  [FAIL] pnpm not found"; PASS=false
    fi
    if docker info >/dev/null 2>&1; then
        echo "  [ok] docker daemon"
    else
        echo "  [FAIL] docker daemon not running"; PASS=false
    fi
    if [ -f .env ]; then
        echo "  [ok] .env exists"
    else
        echo "  [FAIL] .env missing (run: cp .env.example .env)"; PASS=false
    fi
    echo ""
    echo "infra ports (must-pass; run 'just up' first):"
    for PORT in 5432 6379 8545; do
        if nc -z localhost "$PORT" 2>/dev/null; then
            echo "  [ok] port $PORT"
        else
            echo "  [FAIL] port $PORT not responding"; PASS=false
        fi
    done
    echo ""
    echo "app ports (informational, M0 — not started in this epic):"
    for PORT in 3000 3001; do
        if nc -z localhost "$PORT" 2>/dev/null; then
            echo "  [info] port $PORT in use"
        else
            echo "  [info] port $PORT not in use"
        fi
    done
    echo ""
    if [ "$PASS" = "true" ]; then
        echo "doctor: all checks passed."
    else
        echo "doctor: one or more checks failed (see above)."
        exit 1
    fi

# Start infra services (postgres, redis, anvil)
up:
    {{ compose }} up -d --wait --wait-timeout 120

# Stop infra services
down:
    {{ compose }} down

# Apply pending Prisma migrations
migrate:
    {{ pnpm }} db:migrate

# Create and apply a new migration (interactive, dev only)
migrate-dev:
    {{ pnpm }} db:migrate:dev

# Show Prisma migration status
migrate-status:
    {{ pnpm }} db:migrate:status

# Wipe volumes and re-migrate — pass 'yes' to confirm: just reset yes
reset confirm:
    #!/usr/bin/env bash
    [ "{{ confirm }}" = "yes" ] || { echo "Usage: just reset yes"; exit 1; }
    {{ compose }} down -v
    just up
    {{ pnpm }} db:migrate

# Tail service logs — pass service name to filter: just logs postgres
logs service='':
    {{ compose }} logs -f {{ service }}

# Show service status
ps:
    {{ compose }} ps

# Start infra, migrate, and serve all apps (each app in its own terminal)
dev: up migrate
    {{ pnpm }} dev

# Run tests — pass package name to scope: just test api
test project='':
    #!/usr/bin/env bash
    if [ -n "{{ project }}" ]; then
        pnpm --filter "{{ project }}" test
    else
        {{ pnpm }} test
    fi

# Seed the database (not implemented — lands in M1+ alongside indexer)
seed:
    @echo "seed: not implemented"; exit 69

# Remove build artifacts and caches
clean:
    rm -rf node_modules .pnpm-store dist .next
