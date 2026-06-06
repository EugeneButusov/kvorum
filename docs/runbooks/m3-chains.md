# M3 Chains Runbook

## Purpose

This runbook defines `CHAIN_CONFIG` provisioning guidance for the M3 multi-chain Aave rollout.
It pairs ADR-058 (per-chain `headLag` confirmed-head model) with ADR-064 (per-source chain binding on `dao_source.chain_id`).

All values here are recommended starting points. Operators tune final values during RPC provisioning and incident response.

## Recommended chain set

| Chain                   | chainId   | headLag (recommended) | Finality basis                                                  |
| ----------------------- | --------- | --------------------- | --------------------------------------------------------------- |
| Ethereum                | `0x1`     | 12                    | LMD-GHOST finality model; about two epochs buffer               |
| Polygon PoS             | `0x89`    | 128                   | Heimdall checkpoint cadence and delayed practical finality      |
| Avalanche C-Chain       | `0xa86a`  | 5                     | Snowman++ deterministic finality; lag mainly for RPC indexing   |
| Arbitrum One            | `0xa4b1`  | 30                    | Sequencer-reorg buffer before L1 finality                       |
| Optimism                | `0xa`     | 40                    | Sequencer-reorg buffer                                          |
| Base                    | `0x2105`  | 40                    | Sequencer-reorg buffer                                          |
| Gnosis                  | `0x64`    | 20                    | GBC/Gasper style finality with short block times                |
| BNB Smart Chain         | `0x38`    | 15                    | Fast-finality model with conservative cushion                   |
| Scroll                  | `0x82750` | 40                    | zk-rollup operated as sequencer-reorg risk until proof finality |
| Linea                   | `0xe708`  | 40                    | zk-rollup operated as sequencer-reorg risk                      |
| Celo                    | `0xa4ec`  | 40                    | OP-stack migration context; sequencer-reorg style safety buffer |
| Sonic                   | `0x92`    | 10                    | High-throughput L1 with short practical finality                |
| Metis (deprecated)      | `0x440`   | 40                    | Backfill-only; OP-stack style buffer                            |
| zkSync Era (deprecated) | `0x144`   | 40                    | Backfill-only; zk-rollup sequencer/proof timing buffer          |

Validation caveat:

- Chain IDs above are canonical and should be copied as-is.
- Re-validate headLag tuning, finality rationale, and deprecation list against live deployment facts during R3/Y provisioning.

## Provisioning requirements

- Define at least one primary and one fallback provider per chain in `CHAIN_CONFIG.chains[].providers`.
- Source provider secrets from vault-backed env generation flow (ADR-028). Never commit real URLs with credentials.
- Confirm historical `eth_getLogs` availability on every configured chain before enabling live pollers.

## Aave IPFS enrichment env

`aave_governance_v3` proposal derivation performs a best-effort post-commit IPFS metadata fetch for title/description enrichment. Operators can override the defaults with:

- `IPFS_GATEWAY_URL` — primary gateway base. Default: `https://ipfs.io/ipfs`
- `IPFS_GATEWAY_FALLBACK_URL` — optional fallback gateway tried before leaving the row in DLQ
- `IPFS_FETCH_TIMEOUT_MS` — per-gateway timeout in milliseconds. Default: `2500`

Failures do not block proposal derivation; they leave or keep a retryable `aave_ipfs_title_fetch` DLQ row for `admin-cli dlq retry`.

## Registering sources

R1 requires explicit per-source chain binding at registration time.

Example:

```bash
admin-cli daos source add aave --type aave_voting_machine --chain 0x89 --config '{"governor_address":"0x..."}'
```

`--chain` is mandatory and normalized via `normalizeChainId` in admin-cli.

## Local ClickHouse migration note (R2)

R2 edits `libs/sources/core/migrations-clickhouse/0001_core_ch_source_of_truth.sql` in place.
If `core_001` was already applied in your local ClickHouse, `clickhouse-migrations` checksum
verification will fail on re-run.

Reset path:

```bash
docker compose down -v clickhouse
docker compose up -d clickhouse
pnpm -w db:migrate:ch
```

## Local migration reset note (R3)

R3 renames the existing ClickHouse migrations to the stable global-ordinal convention
`NNNN_<source>_<name>.sql` and adds `0004_aave_archive.sql`. If the old ClickHouse filenames
were already applied locally, `clickhouse-migrations` will see changed version/name/checksum
metadata. This is the final expected ClickHouse wipe for the M3 migration-order work; future
ClickHouse migrations should append at the next global ordinal.

Reset path:

```bash
docker compose down -v clickhouse
docker compose up -d clickhouse
pnpm -w db:migrate:ch
```

R3 also edits the core Postgres creation migration and committed Compound seeds in place:
`dao_source.chain_id` no longer has a default and the uniqueness constraint now includes
`chain_id`. A populated local Postgres database needs a reset before re-running migrations.

Reset path:

```bash
pnpm -w db:reset
```

Fresh CI containers are unaffected.

## Aave stitch-hold alerting

`aave_voting_machine` vote derivation can intentionally hold rows when a voting-chain event arrives before the corresponding mainnet proposal is derived. This is the ADR-065 `no_proposal` path: the row stays underived, is retried indefinitely, and surfaces via `indexer_stitch_pending_seconds`.

Alert query:

```promql
max by (voting_chain_id) (indexer_stitch_pending_seconds{source_type="aave_voting_machine"})
```

Operator guidance:

- A brief non-zero value is expected during normal bridge and derivation lag between mainnet proposal creation and voting-chain activity.
- Page when the backlog age exceeds an agreed threshold, with `6h` as the default starting point.
- Head-of-line risk is accepted: more than 50 held votes on one voting chain can block newer derivable votes on that same chain until the missing proposal lands.
