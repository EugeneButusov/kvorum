# backfill

Commands:

- `admin-cli backfill start <dao_source_id> [--from-block N] [--to-block N] [--dry-run]`
- `admin-cli backfill status <dao_source_id>`

Notes:

- `start` runs foreground and stops when the CLI process receives `SIGINT` or `SIGTERM`.
- On completed runs, backfill checkpoints are finalized (cleared).
