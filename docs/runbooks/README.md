# Runbooks

Operational runbooks for Kvorum. Each runbook is self-contained and assumes a fresh SSH session on the production host.

| Runbook                                                    | When to use                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [branch-protection.md](branch-protection.md)               | One-time setup of branch protection rules on GitHub               |
| [actor-merge.md](actor-merge.md)                           | Merge two actor identities safely and verify the redirect state   |
| [caddy-deployment.md](caddy-deployment.md)                 | First deploy, config reload, cert monitoring                      |
| [gap-fill.md](gap-fill.md)                                 | Startup ingestion gap behavior and manual catch-up operation      |
| [m3-chains.md](m3-chains.md)                               | Multi-chain `CHAIN_CONFIG` and per-chain `headLag` provisioning   |
| [secrets-rotation.md](secrets-rotation.md)                 | Rotating any production credential                                |
| [state-reconciliation.md](state-reconciliation.md)         | Operating proposal state reconciler and validating backlog drain  |
| [m5-acceptance.md](m5-acceptance.md)                       | Validate the AI cost ceiling (AC #3) + budget-cap disable (AC #4) |
| [m5-ai-backfill.md](m5-ai-backfill.md)                     | Run the one-time full-history AI backfill under the cost ceiling  |
| [m5-budget-cap-ops.md](m5-budget-cap-ops.md)               | Read spend, lower/raise an AI budget cap, confirm disabled state  |
| [m5-ai-dlq-triage.md](m5-ai-dlq-triage.md)                 | Inspect + retry failed AI jobs (`ai_dlq` / `ai_job_dlq`)          |
| [m5-ai-model-version-bump.md](m5-ai-model-version-bump.md) | Safely change an AI prompt/schema/model + re-generate             |

## General conventions

- Commands prefixed with `#` run as root; `$` runs as the kvorum service user.
- All secrets are stored in the vault (ADR-028). The host `.env` is a derived artifact — never edit it by hand; regenerate with `infra/scripts/provision-env.sh`.
- After any `.env` change, restart the affected service via `admin-cli restart <service>` (available from M2 onward).
