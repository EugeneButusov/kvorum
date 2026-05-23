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
$ admin-cli restart <service>          # available from M2
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

The rotation uses a grace window with two peppers:

- `HMAC_PEPPER_CURRENT` (required)
- `HMAC_PEPPER_PREVIOUS` (optional; present only during rotation)

Encoding contract: each pepper is canonical base64 for exactly 32 random bytes.

```bash
openssl rand -base64 32
```

Rotation procedure:

1. Generate a new pepper value (`openssl rand -base64 32`).
2. In vault, set:
   `HMAC_PEPPER_CURRENT=<new>`
   `HMAC_PEPPER_PREVIOUS=<old current>`
3. Run `infra/scripts/provision-env.sh --force`.
4. Restart `api`.
5. During the grace window, monitor `kvorum_auth_pepper_match{pepper="previous"}`.
6. Only remove `HMAC_PEPPER_PREVIOUS` after that metric has stayed at zero long enough that active keys have re-hashed on use.
7. Run `infra/scripts/provision-env.sh --force` and restart `api` again.

Residual risk: keys that remain dormant for the full grace window are never re-hashed. Once `HMAC_PEPPER_PREVIOUS` is removed, those keys will fail authentication (401). Operators must either force-rotate dormant keys before cutover or accept that breakage.

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

## RPC provider URLs (Alchemy, Ankr, public RPCs)

**Consumers**: `indexer` (via `FailoverRpcClient` in `@libs/chain`).

**Configuration shape** (`CHAIN_CONFIG` env var — single-line JSON):

```json
{
  "chains": [
    {
      "chainId": 1,
      "name": "ethereum",
      "reorgHorizon": 12,
      "providers": [
        {
          "name": "alchemy-mainnet",
          "url": "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
          "kind": "http",
          "priority": 1
        },
        {
          "name": "ankr-mainnet",
          "url": "https://rpc.ankr.com/eth/YOUR_KEY",
          "kind": "http",
          "priority": 2
        }
      ]
    }
  ]
}
```

The `name` field is used as a Prometheus `provider` label — keep it stable across rotations to preserve metric continuity. The `url` carries the secret key; never commit it.

**1Password item naming**: `RPC_<CHAIN_NAME>_<PROVIDER_NAME>` (e.g., `RPC_ETHEREUM_ALCHEMY`). Store the full URL (including the API key path segment) as the item password field.

**Archive-node requirement**: The voting power snapshot job (L3) calls `getPriorVotes(address, historicalBlock)` on the COMP token contract. This requires the RPC provider to retain full historical state at the target block. Free-tier Alchemy and Ankr both offer archive-node access; verify this is enabled on the key being provisioned. A non-archive endpoint returns an error for blocks older than ~128 (fast-sync window), which causes the snapshot job to route the proposal to `snapshot_compute_stage` DLQ.

**Zero-downtime rotation procedure**:

1. Generate a new key in the provider's dashboard (keep the old key active).
2. Update `CHAIN_CONFIG` in the 1Password vault to use the new URL for the target provider entry.
3. Verify the new URL works: `curl -s -X POST <new_url> -H 'content-type: application/json' -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
4. Set `CHAIN_CONFIG` on the indexer host (via systemd `Environment=` or container env) using the updated vault value.
5. Restart `indexer`. On startup, `FailoverRpcClient` re-runs chainId verification against all providers.
6. Verify in logs that the rotated provider is logged as "chainId verified" (not "unusable"). Check `kvorum_ingestion_provider_verified` gauge in Prometheus.
7. Revoke the old key in the provider's dashboard.

**Crashloop-amplifies-load warning**: If the indexer crashloops, each restart re-runs chainId probes (3 retries × exponential backoff per provider × N providers). A crashlooping indexer hitting a degraded provider will hammer it. If crashloops are observed alongside a degraded provider, set that provider's `url` to a known-good fallback (or remove it from `CHAIN_CONFIG`) before investigating the root cause.

**SPEC §3.12 quota-alert gap**: `kvorum_ingestion_rpc_quota_utilization` (80%-utilization alert) is not emitted in M1. The `dailyQuota` field on each `ProviderConfig` entry is typed and ready; the gauge wires up in M7. Until then, compute utilization manually from `kvorum_ingestion_rpc_requests_total` divided by the provider's daily quota.

---

## Backup storage credentials

**TBD** — full procedure to be written when B2 (backup automation) is merged.

---

## Vault master password

The vault master password paper backup is stored in a sealed envelope in a fireproof location. See ADR-028 for the recovery procedure if the operator's primary authentication device is lost.

Do not store the master password anywhere digitally — its only safe storage is the paper backup.
