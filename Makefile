.DEFAULT_GOAL := help

COMPOSE := docker compose
PNPM    := pnpm -w

.PHONY: help install doctor up down migrate migrate-dev migrate-status \
        reset logs ps dev test seed clean

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) \
		| awk -F ':.*## ' '{printf "  %-20s %s\n", $$1, $$2}'

install: ## install node dependencies
	$(PNPM) install

doctor: ## check prerequisites and infra port health
	@PASS=true; \
	echo "prerequisites:"; \
	if command -v node >/dev/null 2>&1; then \
		NODE_VER=$$(node --version | sed 's/v//'); \
		NODE_MAJOR=$$(echo "$$NODE_VER" | cut -d. -f1); \
		if [ "$$NODE_MAJOR" -ge 24 ]; then \
			echo "  [ok] node $$NODE_VER"; \
		else \
			echo "  [FAIL] node $$NODE_VER (need >= 24)"; PASS=false; \
		fi; \
	else \
		echo "  [FAIL] node not found"; PASS=false; \
	fi; \
	if command -v pnpm >/dev/null 2>&1; then \
		PNPM_VER=$$(pnpm --version); \
		PNPM_MAJOR=$$(echo "$$PNPM_VER" | cut -d. -f1); \
		if [ "$$PNPM_MAJOR" -ge 11 ]; then \
			echo "  [ok] pnpm $$PNPM_VER"; \
		else \
			echo "  [FAIL] pnpm $$PNPM_VER (need >= 11)"; PASS=false; \
		fi; \
	else \
		echo "  [FAIL] pnpm not found"; PASS=false; \
	fi; \
	if docker info >/dev/null 2>&1; then \
		echo "  [ok] docker daemon"; \
	else \
		echo "  [FAIL] docker daemon not running"; PASS=false; \
	fi; \
	if [ -f .env ]; then \
		echo "  [ok] .env exists"; \
	else \
		echo "  [FAIL] .env missing (run: cp .env.example .env)"; PASS=false; \
	fi; \
	echo ""; \
	echo "infra ports (must-pass; run 'make up' first):"; \
	for PORT in 5432 6379 8545; do \
		if nc -z localhost $$PORT 2>/dev/null; then \
			echo "  [ok] port $$PORT"; \
		else \
			echo "  [FAIL] port $$PORT not responding"; PASS=false; \
		fi; \
	done; \
	echo ""; \
	echo "app ports (informational, M0 — not started in this epic):"; \
	for PORT in 3000 3001; do \
		if nc -z localhost $$PORT 2>/dev/null; then \
			echo "  [info] port $$PORT in use"; \
		else \
			echo "  [info] port $$PORT not in use"; \
		fi; \
	done; \
	echo ""; \
	if [ "$$PASS" = "true" ]; then \
		echo "doctor: all checks passed."; \
	else \
		echo "doctor: one or more checks failed (see above)."; exit 1; \
	fi

up: ## start infra services (postgres, redis, anvil)
	$(COMPOSE) up -d --wait --wait-timeout 120

down: ## stop infra services
	$(COMPOSE) down

migrate: ## apply pending Prisma migrations
	$(PNPM) db:migrate

migrate-dev: ## create and apply a new migration (interactive, dev only)
	$(PNPM) db:migrate:dev

migrate-status: ## show Prisma migration status
	$(PNPM) db:migrate:status

reset: ## wipe volumes and re-migrate (requires CONFIRM=yes)
	@[ "$(CONFIRM)" = "yes" ] || { echo "Usage: make reset CONFIRM=yes"; exit 1; }
	$(COMPOSE) down -v
	$(MAKE) up
	$(PNPM) db:migrate

logs: ## tail service logs (SERVICE=name for a specific service)
	$(COMPOSE) logs -f $(SERVICE)

ps: ## show service status
	$(COMPOSE) ps

dev: up migrate ## start infra, migrate, and serve all apps
	npx nx run-many -t serve --parallel=4

test: ## run tests (PROJECT=name to scope to one project)
	$(if $(PROJECT),npx nx test $(PROJECT),$(PNPM) test)

seed: ## seed the database (not implemented — lands in M1+ alongside indexer)
	@echo "seed: not implemented"; exit 69

clean: ## remove build artifacts and caches
	rm -rf node_modules .pnpm-store .nx dist .next
