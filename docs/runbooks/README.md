# Runbooks

Operational runbooks for Kvorum. Each runbook is self-contained and assumes a fresh SSH session on the production host.

| Runbook                                    | When to use                        |
| ------------------------------------------ | ---------------------------------- |
| [secrets-rotation.md](secrets-rotation.md) | Rotating any production credential |

## General conventions

- Commands prefixed with `#` run as root; `$` runs as the kvorum service user.
- All secrets are stored in the vault (ADR-028). The host `.env` is a derived artifact — never edit it by hand; regenerate with `infra/scripts/provision-env.sh`.
- After any `.env` change, restart the affected service via `kvorum-admin restart <service>` (available from M2 onward).
