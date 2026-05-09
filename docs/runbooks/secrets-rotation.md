# Secrets rotation runbook

Covers rotation of every secret class held in the vault (ADR-028). Run each section only for the secret class being rotated.

**Pre-requisites**: 1Password CLI (`op`) installed and authenticated on the host.

---

## General rotation procedure

1. Update the new value in the 1Password vault.
2. Re-run `infra/scripts/provision-env.sh` to regenerate `.env` on the host.
3. Restart the affected service(s).
4. Verify the service is healthy (`/health` endpoint for the API; log tail for workers).

```bash
$ infra/scripts/provision-env.sh --force
$ kvorum-admin restart <service>          # available from M2
```

---

## Database password (Postgres)

**Consumers**: `api`, `indexer`, `ai-worker` (all read `DATABASE_URL`).

**TBD** — full procedure to be written when B1 (Docker Compose stack) is merged.

Outline:

1. Rotate the Postgres user password inside the running container.
2. Update `DATABASE_URL` in the vault.
3. Run `provision-env.sh --force`.
4. Restart all three NestJS services.

---

## HMAC pepper (API key hashing — ADR-025)

**Consumers**: `api`.

The pepper rotation requires a grace window: both old and new values must be valid concurrently so in-flight API key verifications do not fail mid-rotation.

**TBD** — full procedure to be written when the API key hashing feature lands (M1).

Outline:

1. Generate a new pepper value (`openssl rand -hex 32`).
2. Add it to the vault as `HMAC_PEPPER_CURRENT`; copy the old value to `HMAC_PEPPER_PREVIOUS`.
3. Run `provision-env.sh --force`.
4. Restart `api`. The service now accepts keys hashed with either pepper.
5. After the grace window (24 h recommended), remove `HMAC_PEPPER_PREVIOUS` from the vault.
6. Run `provision-env.sh --force` again and restart `api`.

---

## AI provider API keys (Anthropic, OpenAI)

**Consumers**: `ai-worker`.

**TBD** — full procedure to be written when M5 (AI integration) is merged.

Outline:

1. Generate a new key in the provider's dashboard.
2. Update the vault entry.
3. Run `provision-env.sh --force`.
4. Restart `ai-worker`.
5. Verify the new key is active (check `ai-worker` logs for successful provider calls).
6. Revoke the old key in the provider's dashboard.

---

## RPC provider API keys (Alchemy, Ankr, etc.)

**Consumers**: `indexer`.

**TBD** — full procedure to be written when M1 (indexer integration) is merged.

Outline:

1. Create a new app/key in the provider's dashboard.
2. Update the vault entry.
3. Run `provision-env.sh --force`.
4. Restart `indexer`.
5. Delete the old key in the provider's dashboard.

---

## Backup storage credentials

**TBD** — full procedure to be written when B2 (backup automation) is merged.

---

## Vault master password

The vault master password paper backup is stored in a sealed envelope in a fireproof location. See ADR-028 for the recovery procedure if the operator's primary authentication device is lost.

Do not store the master password anywhere digitally — its only safe storage is the paper backup.
