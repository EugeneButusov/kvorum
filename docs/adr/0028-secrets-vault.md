# ADR-028 — Off-host secrets vault for production credentials

- **Status**: Proposed
- **Date**: 2026-05-08
- **Spec sections affected**: 7.5, 7.6
- **Related**: ADR-025, DR-014

## Context

SPEC §7.5 says "the host's `.env` files are _not_ in the repository, but their contents are documented in a runbook stored in a secure location (not the repository)." The "secure location" is unspecified.

If that location is the host itself, total host loss = total secret loss. The recovery objective in §7.5 (RTO ≤ 4 hours from a fresh host) is unachievable without an off-host source for credentials: deployment scripts cannot regenerate database passwords, RPC API keys, the HMAC pepper from ADR-025, or the AI provider keys. Without an off-host secrets store, "provision a new host, restore Postgres" stops at the database password.

§7.6 requires that "no secrets are committed to the git repository at any time," which is correct, but says nothing about where they should live instead.

## Decision

Production secrets are stored in a managed password vault — **1Password Business** as the v1 default, with Bitwarden as a documented alternative. The host's `.env` file is a derived artifact, regenerated from the vault on host setup. A documented runbook (also in the vault, alongside the secrets) lists every secret, its purpose, its consumer service, and its rotation procedure.

The vault holds:

- Database passwords (Postgres, Redis, ClickHouse-when-activated)
- The HMAC pepper for API key hashing (ADR-025)
- AI provider API keys (Anthropic, OpenAI)
- RPC provider API keys (Alchemy, Ankr, etc.)
- Block explorer API keys (optional enrichment path, §3.8)
- Transactional email credentials (SES or equivalent, §7.12)
- Backup storage credentials (Hetzner Object Storage / Backblaze)
- TLS-related secrets if any are not handled by Caddy's auto-renewal
- The vault master password's _paper_ backup is held separately (a sealed envelope in a fireproof location); this is the only out-of-band credential and exists solely to recover the vault if the operator's authentication device is lost.

A short shell script (`infra/scripts/provision-env.sh`) reads the vault via the 1Password CLI (`op`) and generates `.env` on the target host. The script is idempotent and refuses to overwrite a populated `.env` without `--force`.

Secret rotation:

1. Update the value in the vault.
2. Run `provision-env.sh` to refresh `.env`.
3. Restart the affected service via `kvorum-admin` (the CLI gains a `restart <service>` command).
4. Audit-log the rotation.

For the HMAC pepper specifically (ADR-025), rotation involves a grace window during which both old and new peppers are valid. The vault holds both during the window; the application reads both via environment variables (`HMAC_PEPPER_CURRENT`, `HMAC_PEPPER_PREVIOUS`).

## Alternatives considered

- **Encrypted backup of `.env` on object storage.** Requires a separate decryption key, recursing the problem one level. Where is _that_ key stored?
- **Cloud secret manager (AWS Secrets Manager, GCP Secret Manager).** Adds a vendor dependency and a runtime egress cost. Defensible if Kvorum is already on AWS or GCP; not justified for a Hetzner deployment at v1 scale.
- **Plain-text runbook on a USB stick.** Works but is operationally fragile (loss, theft, no versioning, no access audit). The vault solves these for €5–10/month.
- **HashiCorp Vault, self-hosted.** Heavy for v1; reintroduces the bootstrap problem (where do Vault's own secrets live?).

## Consequences

- §7.5's RTO of ≤ 4 hours is achievable: provision new host, run setup script which fetches secrets from the vault, restore Postgres backup, restart services.
- The vault provider becomes a soft dependency: outages block fresh deployments and rotations but do not affect running services (which read `.env` at startup).
- Cost: 1Password Business is ~€8/month; absorbed into the §7.8 "Domain registration" / miscellaneous category (~€1–5 already budgeted) plus a small overrun, total stays well under the €60 ceiling.
- §7.5's "secure location" language is replaced with an explicit reference to this ADR. §7.6 gains a paragraph on secret storage that points here.
- A `docs/runbooks/secrets-rotation.md` is added during M0 implementation, describing the procedure for each secret class.
