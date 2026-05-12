# Plan: shorten root typecheck script

## Problem

`package.json` `typecheck` is a 13-entry `&&`-chain. `build` and `test` are one line each (`pnpm -r run build/test`). `typecheck` should match that pattern.

## Approach

Add a `"typecheck"` script to every package that lacks one, then collapse the root command to `pnpm -r run typecheck`.

`admin-cli` already has it. All others need it.

## Changes

### Apps — `tsc --noEmit -p tsconfig.app.json`

| Package     | File                          |
| ----------- | ----------------------------- |
| `api`       | `apps/api/package.json`       |
| `indexer`   | `apps/indexer/package.json`   |
| `ai-worker` | `apps/ai-worker/package.json` |

### Dashboard — `tsc --noEmit -p tsconfig.json` (Next.js uses plain tsconfig.json, not tsconfig.app.json)

| Package     | File                          |
| ----------- | ----------------------------- |
| `dashboard` | `apps/dashboard/package.json` |

### Libs — `tsc --noEmit -p tsconfig.lib.json`

| Package               | File                                 |
| --------------------- | ------------------------------------ |
| `@libs/domain`        | `libs/domain/package.json`           |
| `@libs/db`            | `libs/db/package.json`               |
| `@libs/chain`         | `libs/chain/package.json`            |
| `@libs/ai`            | `libs/ai/package.json`               |
| `@libs/utils`         | `libs/utils/package.json`            |
| `@libs/observability` | `libs/observability/package.json`    |
| `@sources/core`       | `libs/sources/core/package.json`     |
| `@sources/compound`   | `libs/sources/compound/package.json` |
| `@nest/observability` | `nest/observability/package.json`    |
| `@nest/compound`      | `nest/sources/compound/package.json` |

### Root

```json
"typecheck": "pnpm -r run typecheck"
```

## Side-effect: wider coverage

The current root command omits `@libs/observability` and `@sources/core`. After this change `pnpm -r run typecheck` will cover every package. That is strictly better.

## Verification

```bash
pnpm -w typecheck   # must exit 0
```

## Not in scope

- No changes to tsconfig files.
- No changes to the Lefthook pre-commit hook (it already invokes `pnpm -w typecheck`).
