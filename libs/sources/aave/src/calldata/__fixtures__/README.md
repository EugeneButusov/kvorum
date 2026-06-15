# Calldata decoder fixtures

## `historical-actions.json` (v3)

ABI-encoded calldata from executed Aave Governance v3 proposals on Ethereum mainnet.
Entries target v3-era Aave contracts (PoolConfigurator, ACL Manager, Collector, etc.).

Coverage bar: ≥95% decoded via the bundled Aave ABI library under `source_type='aave_governance_v3'`.

## `historical-actions-v2.json` (v2)

ABI-encoded calldata representative of executed Aave Governance v2 proposals on Ethereum mainnet
(approximately Dec 2020 – Dec 2023, proposal IDs 1–379 at contract `0xEC568fffba86c094cf06b22134B23074DFE2252c`).

**Coverage bar:** ≥95% decoded via the bundled Aave ABI library under `source_type='aave_governor_v2'`.

**This bar is over a curated in-protocol sample, not true historical decode coverage.** v2 proposals
targeting non-Aave bridge infrastructure (FxRoot / Arbitrum Inbox / L1CrossDomainMessenger) are
intentionally under-sampled here — those calls are an acknowledged out-of-library miss handled at runtime
by the decoder's `selector_index` / proxy / Etherscan steps.

**Target contracts included:**

- `0x311Bb771e4F8952E6Da169b425E7e92d6Ac45756` — v2 LendingPoolConfigurator
- `0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5` — v2 LendingPoolAddressesProvider
- `0xEC568fffba86c094cf06b22134B23074DFE2252c` — AaveGovernanceV2
- `0x4da27a545c0c5B758a6BA100e3a049001de870f5` — StakedTokenV2Rev3 (stkAAVE)

**Shared selectors (already decoded by v3 `aave-pool-configurator.json`):**

- `configureReserveAsCollateral(address,uint256,uint256,uint256)` — `0x7c4e560b`
- `setReserveFactor(address,uint256)` — `0x4b4e6753`
- `setReserveInterestRateStrategyAddress(address,address)` — `0x1d2118f9`
