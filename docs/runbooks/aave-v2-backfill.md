# Aave Governance v2 — Operability Notes

## Status

**Dormant source.** AaveGovernanceV2 (`0xEC568fffba86c094cf06b22134B23074DFE2252c`) governed the
Aave v2 protocol on Ethereum mainnet from ~December 2020 through December 2023 (proposal IDs 1–379).
The contract is no longer active; no new proposals are created via this governor. The live indexer
poller boots for this source but produces no events under normal operation.

## Backfill

As of Epic W (M3), `aave_governor_v2` is registered in the admin-cli backfill plugin registry.
The full historical backfill run is an **Epic Y3 (Y1 register / Y3 acceptance)** operator step —
it is **not** triggered automatically and should be run manually.

### Running the historical backfill

```bash
admin-cli backfill start aave_governor_v2 \
  --from-block 11427398 \
  --dao-source-id <dao_source.id>
```

- `11427398` is the `active_from_block` set in the `aave_governor_v2` seed (R3 / #275).
- The dao_source row is seeded with `governor_address: '0xEC568fffba86c094cf06b22134B23074DFE2252c'`.
- Expected volume: ~379 proposals + their VoteEmitted / ProposalQueued / ProposalExecuted events.
- DLQ stage to monitor: `aave_governor_v2_archive_write` (CH write failures).

### Validation

Post-backfill validation (row counts vs on-chain proposal IDs) is the **Y3 acceptance** step.
See the Y3 runbook when it is created.

## Selector coverage

v2 calldata decode coverage is gated at ≥95% over a curated in-protocol sample
(`libs/sources/aave/src/calldata/__fixtures__/historical-actions-v2.json`). Cross-chain bridge
actions (FxRoot / Arbitrum Inbox / L1CrossDomainMessenger) are not in the bundled ABI library;
the runtime `selector_index` / proxy / Etherscan decoder steps handle the long tail.
