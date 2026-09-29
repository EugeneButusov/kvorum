# dlq

Commands:

- `admin-cli dlq list [--feature <source>] [--limit N]`
- `admin-cli dlq retry <dlq_id> [--dry-run]`
- `admin-cli dlq accept <dlq_id> --reason <text>`

Notes:

- `accept` rejects empty/whitespace reasons.
- `retry` supports archive-write rows; derive-stage rows are handled through indexer + `derive replay`.
- Aave title/description enrichment failures use the retryable `aave_ipfs_title_fetch` stage. List
  them with `admin-cli dlq list --feature indexer.aave_governance_v3 --format json`, dry-run each
  retry, and verify the configured IPFS gateways before resolving the rows.
