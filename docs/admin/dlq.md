# dlq

Commands:

- `admin-cli dlq list [--feature <source>] [--limit N]`
- `admin-cli dlq retry <dlq_id> [--dry-run]`
- `admin-cli dlq accept <dlq_id> --reason <text>`

Notes:

- `accept` rejects empty/whitespace reasons.
- `retry` supports archive-write rows; derive-stage rows are handled through indexer + `derive replay`.
