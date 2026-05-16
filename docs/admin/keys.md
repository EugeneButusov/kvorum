# keys

Commands:

- `admin-cli keys create <user_id> [--label <label>] [--dry-run]`
- `admin-cli keys list [--user <id>]`
- `admin-cli keys revoke <key_id> [--dry-run]`

Notes:

- `create` prints plaintext key once.
- Key hashes are persisted using HMAC with `HMAC_PEPPER_CURRENT`.
