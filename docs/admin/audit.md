# audit

Commands:

- `admin-cli audit list [--limit <n>]`

Fields:

- `id`
- `command`
- `args`
- `executor`
- `executor_kind`
- `started_at`
- `completed_at`
- `outcome`
- `error`

Notes:

- Rows with `completed_at = null` and `outcome = null` mean the command did not finish cleanly (crash, SIGKILL, or in-progress). This is expected for long-running `backfill start` processes that are killed.
- Rows are immutable once written; no janitor removes orphan started rows. Use `audit list` to inspect them.
- Mutating commands only: read-only commands (`status`, `keys list`, `dlq list`, etc.) do not produce audit rows.
