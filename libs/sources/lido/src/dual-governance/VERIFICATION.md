# Dual Governance — vendored ABI verification record (AB0)

Terse, committed evidence that the ABIs + addresses in this directory match the deployed mainnet
contracts. Full forensic narrative is in `docs/planning/ab0-dg-archaeology.md` (local scratch).

- **Canonical source:** `lidofinance/dual-governance` @ `ba9dfc9213ec888993937a699e2a587a0082720f`
  (`deploy-artifacts/deploy-artifact-mainnet.toml` + `contracts/`).
- **Live verification:** mainnet, 2026-06-24, block 25387417 (read-only `eth_getCode` / `eth_call`;
  creation blocks via archive `getCode` binary search).

## Addresses (mainnet, chainId 0x1)

| Contract                   | Address                                      | Deployed (block / date) | Bytecode sha256 (first 16) |
| -------------------------- | -------------------------------------------- | ----------------------- | -------------------------- |
| DualGovernance (current)   | `0xC1db28B3301331277e307FDCfF8DE28242A4486E` | 23095715 / 2025-08-08   | `e5b1ca5757a2054a`         |
| DualGovernance (legacy)    | `0xcdF49b058D606AD34c5789FD8c3BF8B3E54bA2db` | 22537924 / 2025-05-22   | superseded; code persists  |
| EmergencyProtectedTimelock | `0xCE0425301C85c5Ea2A0873A2dEe44d78E02D2316` | 22537921 / 2025-05-22   | `f35774b3ff345571`         |
| AdminExecutor              | `0x23E0B465633FF5178808F4A75186E2F2F9537021` | 22537920 / 2025-05-22   | `cda19b68ed25c0f9`         |
| Escrow (master copy)       | `0xd6A67636c05BeB5B4a5c90D408b03A63c4e39426` | 23095715 / 2025-08-08   | `e203883f62982545`         |
| ResealManager              | `0x7914b5a1539b97Bd0bbd155757F25FD79A522d24` | —                       | `88fd5ff9eea9caee`         |
| ConfigProvider             | `0xa1692Af6FDfdD1030E4E9c4Bc429986FA64CB5EF` | —                       | `0311d32d6961deac`         |

## Verified facts

- **All contracts are immutable / non-proxy** (`eip1967Impl == null`, not EIP-1167 clones). No
  upgrade plane — so "no pending upgrade" reduces to the governance-wiring check below.
- **Governance wiring (active-DG check passes):** `timelock.getGovernance() == 0xC1db28B3…` (current
  DG), `timelock.getAdminExecutor() == 0x23E0B465…`, `isEmergencyModeActive() == false`,
  `getProposalsCount() == 11`. The legacy DG is no longer wired to the timelock.
- **Escrow is master-copy + EIP-1167 clones.** `DG.getVetoSignallingEscrow()` returns a live 45-byte
  minimal-proxy clone `0x165813A31446a98c84E20Dda8C101BB3C8228e1c` (this is the address the issue
  abbreviated as `0x165813A3…` — an instance, NOT the master copy). `getRageQuitEscrow() == 0x0`
  (no rage quit has occurred). Index `NewSignallingEscrowDeployed` on the master copy.
- **State machine:** `getPersistedState()` / `getEffectiveState()` / `getStateDetails()` all decode;
  current state `Normal` (entered 2025-08-08). No `getState()`. State enum is
  `NotInitialized(0), Normal(1), VetoSignalling(2), VetoSignallingDeactivation(3), VetoCooldown(4), RageQuit(5)`.
- **Event topic0 hashes** are locked in `abi/dual-governance-abi.spec.ts` (CI-enforced).

## Findings handed to AB1–AB4 (see scratch doc for detail)

1. **Two DG eras** — complete ADR-024 state history needs both the legacy and current DG; the
   Timelock proposal stream is single-source from block 22537921.
2. **PG enum gap** — `dual_governance_state` omits `NotInitialized`; map by name, not ordinal.
3. **ADR-0030 titling rule is unimplementable** as written (assumes a DG→Aragon link that does not
   exist on-chain). **ADR-0031** needs the rage-quit effective window — available via the escrow.

## AB3 same-tx correlation check (2026-06-25)

Although no DG→Aragon **field** link exists (finding 3), the Aragon enactment script calls
`submitProposal` synchronously, so the Aragon `ExecuteVote` and the Timelock `ProposalSubmitted`
share the **enactment transaction**. Verified against 3 real mainnet submissions (Blockscout logs):

| Timelock `ProposalSubmitted` tx    | co-tx Aragon `ExecuteVote` voteId |
| ---------------------------------- | --------------------------------- |
| `0x36a2ceae…552e86` (blk 25373650) | 202                               |
| `0xc1c03334…787de1` (blk 25122802) | 201                               |
| `0xbd138cbc…337fd3` (blk 24872110) | 199                               |

Each submission tx carries **exactly one** `ExecuteVote` from the Voting proxy `0x2e59…`, voteId in
the indexed topic. This ratifies AB3's **tx-hash-primary** correlation (ADR-0074 §4): resolve the
Timelock `ProposalSubmitted` tx → co-tx `ExecuteVote` payload `{voteId}` → Aragon `proposal`
(`source_id = voteId`). The `(executor, calls-hash, time-window)` heuristic remains a documented
fallback for any non-co-tx submission.
