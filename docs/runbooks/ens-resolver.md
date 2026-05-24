# ENS resolver runbook

## Scope

This runbook covers the N3 ENS background resolver:

- daily cron in `apps/indexer` (`03:00` schedule)
- bulk/manual refresh commands in `admin-cli`
- expected outcomes and known limitations

## Preconditions

1. `CHAIN_CONFIG` must include Ethereum mainnet (`chainId = 0x1`). ENS Universal Resolver is mainnet-only.
2. Indexer process timezone should match operator intent for the cron schedule (production should use UTC).
3. RPC providers for mainnet must allow `eth_call` to:

- `0xcA11bde05977b3631167028862bE2a173976CA11` (Multicall3)
- `0xce01f8eee7E479C928F8919abD53E553a36CeF67` (ENS Universal Resolver)

## Metrics

### Resolution outcomes

`indexer_ens_resolver_resolutions_total{result="..."}`

`result` values:

- `resolved`: reverse+forward check passed; `actor.display_name` updated
- `no_record`: no reverse ENS name; `actor.display_name` set to `NULL`
- `mismatch`: reverse exists but forward-check failed; no DB write
- `error`: RPC/subcall/decode failure; no DB write

### Tick duration

`indexer_ens_resolver_duration_seconds`

Expect one duration observation per daily run.

## Operations

### Initial post-deploy backfill

Run once after deploying N3:

```bash
pnpm --filter admin-cli exec tsx src/main.ts ens refresh-all
```

This bypasses TTL and processes candidates in pages until idle.

### Single-actor refresh

For triage of one actor:

```bash
pnpm --filter admin-cli exec tsx src/main.ts ens refresh <lowercase_0x_address>
```

Address must be lowercase `0x` + 40 hex chars and must be an actor primary address.

## Expected behavior

1. Contract addresses (multisigs/governors) often return `no_record`; this is normal.
2. `mismatch` means anti-spoofing forward check blocked a write.
3. `error` is retried by the next run; ENS refresh has no DLQ by design.

## Known limitation (N3)

CCIP-Read / `OffchainLookup` resolvers are not supported in the multicall path. Those names are counted as `error` outcomes and will not resolve until explicit CCIP-Read fallback support is added.

## Troubleshooting

1. `error` spikes with near-zero `resolved`:

- verify mainnet RPC provider health and `eth_call` success
- verify Universal Resolver address has not changed operationally

2. No daily duration sample:

- verify indexer process is running
- verify host/process timezone and schedule alignment

3. `refresh <address>` says not found:

- confirm address is lowercase
- confirm it is the actor `primary_address`
