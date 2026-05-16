# backfill

Commands:

- `admin-cli backfill start <dao_source_id> [--from-block N] [--to-block N] [--dry-run]`
- `admin-cli backfill status <dao_source_id>`
- `admin-cli backfill cancel <dao_source_id> [--dry-run]`

Notes:

- `start` runs foreground and supports cooperative cancel via `backfill cancel` or `SIGINT`.
- On completed runs, backfill checkpoints are finalized (cleared).
