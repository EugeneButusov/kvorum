# Runbooks

Operational runbooks for Kvorum. Each runbook is self-contained and assumes a fresh SSH session on the production host.

| Runbook                                            | When to use                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| [branch-protection.md](branch-protection.md)       | One-time setup of branch protection rules on GitHub              |
| [actor-merge.md](actor-merge.md)                   | Merge two actor identities safely and verify the redirect state  |
| [caddy-deployment.md](caddy-deployment.md)         | First deploy, config reload, cert monitoring                     |
| [ch-dictionaries.md](ch-dictionaries.md)           | Applying the PG-sourced ClickHouse dictionary to an environment  |
| [gap-fill.md](gap-fill.md)                         | Startup ingestion gap behavior and manual catch-up operation     |
| [m3-chains.md](m3-chains.md)                       | Multi-chain `CHAIN_CONFIG` and per-chain `headLag` provisioning  |
| [secrets-rotation.md](secrets-rotation.md)         | Rotating any production credential                               |
| [state-reconciliation.md](state-reconciliation.md) | Operating proposal state reconciler and validating backlog drain |

## General conventions

- Commands prefixed with `#` run as root; `$` runs as the kvorum service user.
- All secrets are stored in the vault (ADR-028). The host `.env` is a derived artifact — never edit it by hand; regenerate with `infra/scripts/provision-env.sh`.
- After any `.env` change, restart the affected service via `admin-cli restart <service>` (available from M2 onward).
