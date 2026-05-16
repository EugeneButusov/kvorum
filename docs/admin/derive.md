# derive

Commands:

- `admin-cli derive replay <dao_source_id> [--from-block N] --confirm --production [--dry-run]`
- `admin-cli derive verify <proposal_external_id>`

Notes:

- `replay` only resets derivation watermarks; the running indexer performs actual re-derivation.
- `verify` scope: verifies proposal-row fields only; does not re-decode actions.
