# Aave multi-chain stitch test fixtures

Fixture data for `tests/e2e/aave-multichain-stitch.e2e.spec.ts` — the §3.5 acceptance gate for
Y2 ([#269](https://github.com/EugeneButusov/kvorum/issues/269)).

## Fixture set

`proposal-200/` — **synthetic proposal (ID 200)** with valid ABI-encoded log data.

The fixtures are synthetically constructed (via `generate-fixtures.mjs`) but use
**real ABI encodings** (ethers v6 `Interface.encodeEventLog`) and the real seeded contract
addresses from `aave_002_seed.ts`. They are structurally identical to real on-chain logs
and run through the production decode/ingestion/derivation code path.

### Chains covered

| Chain          | Role                                                            | Contract                                                                                   |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Ethereum `0x1` | Governance V3, PayloadsController (payload 10 — fully executed) | `0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7`, `0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5` |
| Polygon `0x89` | Voting Machine                                                  | `0x44c8b753229006A8047A05b90379A7e92185E97C`                                               |
| Optimism `0xa` | PayloadsController (payload 5 — **lossy, no execution**)        | `0x0E1a3Af1f9cC76A62eD31eDedca291E63632e7c4`                                               |

### Fixture files

| File                                | Contents                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `mainnet-governance.json`           | `ProposalCreated`, `PayloadSent×2`, `VotingActivated`, `ProposalQueued`, `ProposalExecuted`        |
| `polygon-voting-machine.json`       | `ProposalVoteConfigurationBridged`, `ProposalVoteStarted`, `VoteEmitted×2`, `ProposalResultsSent`  |
| `mainnet-payloads-controller.json`  | `PayloadCreated`, `PayloadQueued`, `PayloadExecuted` for payload 10                                |
| `optimism-payloads-controller.json` | `PayloadCreated`, `PayloadQueued` for payload 5 (no `PayloadExecuted` — the **lossy case**)        |
| `block-headers.json`                | `{ chainId → { blockNumber → { hash, timestamp } } }` — injected into derivation via fake registry |
| `expected.json`                     | On-chain truth assertions for DB and API layers                                                    |

### Lossy-execution case (AC #6 gate)

Payload 5 (Optimism) never receives a `PayloadExecuted` event. The test asserts:

- `aave_proposal_payload.status = 'queued'` (not `'executed'`)
- `aave_proposal_payload.executed_at_destination = NULL`
- The mainnet proposal and payload 10 (Ethereum) stitch cleanly

## Regenerate synthetic fixtures

```bash
node --input-type=module tests/e2e/fixtures/aave-multichain/generate-fixtures.mjs
```

## Capture real on-chain data (optional)

`capture.mjs` forks the real chains at coordinated blocks using Anvil and captures
the real logs for a chosen proposal. Archive-RPC endpoints are required.

```bash
MAINNET_ARCHIVE_RPC=https://... \
POLYGON_ARCHIVE_RPC=https://... \
OPTIMISM_ARCHIVE_RPC=https://... \
PROPOSAL_ID=200 \
node --input-type=module tests/e2e/fixtures/aave-multichain/capture.mjs
```

Running capture replaces the fixture files in this directory with real on-chain data
and updates `expected.json` with the real values. Commit the result.

Foundry version used for local anvil in docker-compose: see `docker-compose.yml` image digest comment.
