# ADR-036 — Extend kvorum-admin user surface with create and update subcommands

- **Status**: Proposed
- **Date**: 2026-05-10
- **Spec sections affected**: 6.20.1
- **Related**: #10, #11, #15

## Context

SPEC §6.20.1 defines three `kvorum-admin user` subcommands: `list`, `ban`, and `delete`. This reflects the assumption that user accounts are always self-created through the API authentication flow (sign-up, OAuth, etc.) and that operators never need to provision accounts out-of-band.

In practice two gaps surface early:

1. **Operator bootstrapping.** The first admin or service account must exist before any API key can be issued to it. There is no web-based admin UI (by design — §6.20), so the only alternative today is a direct `INSERT` into the database, which bypasses application-level invariants (credential hashing per ADR-025, account status defaults, audit log emission).

2. **Profile corrections.** Operators occasionally need to correct user metadata (display name, email) without involving the user — for example after a support request or a data-quality incident. Currently this also requires a raw SQL update.

Both cases are low-frequency (operator-only, SSH-gated), but they are real enough that scripting them safely via the CLI is preferable to ad-hoc SQL.

## Decision

Extend `kvorum-admin user` with two additional subcommands:

### `user create`

```
kvorum-admin user create --email <email> --name <name> [--role <role>]
```

- `--email` (required): the account email address; must be unique.
- `--name` (required): display name.
- `--role` (optional): account role; defaults to `user`. Valid values defined by the domain model; at M0 only `user` and `admin` are recognised.
- `--format <format>`: `human` (default) or `json`.

On success, emits the new user's ID and a one-time API key suitable for first login. Human format prints a table; JSON format emits `{"user_id": "…", "api_key": "…"}`.

Internally delegates to the same service layer that handles self-signup, so ADR-025 credential hashing and audit log emission apply automatically.

### `user update`

```
kvorum-admin user update <user_id> [--email <email>] [--name <name>] [--role <role>]
```

- `<user_id>` (required positional): the target account.
- `--email`, `--name`, `--role`: at least one must be supplied; all are optional individually.
- `--format <format>`: `human` (default) or `json`.

On success, emits the updated user record. JSON format emits the full updated user object.

`user update` is non-destructive (no data is deleted), so it does not require `--confirm` or `--production` flags.

## Consequences

- SPEC §6.20.1 command table gains two rows; all other sections are unaffected.
- The `help-snapshot` test suite for the `user` domain must be updated to include the new subcommands.
- No new wiring is needed for service access — the existing `user list`, `user ban`, and `user delete` commands already establish that `UserService` is reachable from the CLI context.
- No schema migration needed: the underlying `User` table is already defined in M0.
- The one-time API key emitted by `user create` must be displayed exactly once (not stored); the CLI must make this explicit in its output.
