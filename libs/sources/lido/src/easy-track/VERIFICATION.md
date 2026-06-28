# Easy Track — vendored ABI verification record

Terse, committed evidence that the ABI + addresses in this directory match the deployed mainnet
EasyTrack contract.

- **Canonical source:** the deployed, Etherscan-verified `EasyTrack` contract (no GitHub-tag pinning
  needed — see "immutable" below). Event ABI cross-checked against `lidofinance/easy-track`.
- **Live verification:** mainnet, 2026-06-28, via `eth.blockscout.com` (verified-contract ABI +
  `creation_transaction_hash`) and a public-RPC `eth_call` (`getEVMScriptFactories()`).

## Addresses (mainnet, chainId 0x1)

| Contract          | Address                                      | Deployed (block / date) | Notes                               |
| ----------------- | -------------------------------------------- | ----------------------- | ----------------------------------- |
| EasyTrack         | `0xF0211b7660680B49De1A7E9f25C65660F0a13Fea` | 13676729 / 2021-11-24   | emits every motion + settings event |
| EVMScriptExecutor | `0xFE5986E06210aC1eCC1aDCafc0cc7f8D63B3F977` | —                       | executes enacted scripts; no events |

- **Creation tx:** `0x55c4c7e33eb92da16871944879d52180c1a2e59c2701404abef864c5196ab7f1` (block 13676729).
  This block is the seed's `active_from_block` (lido_009_easy_track_seed).

## Verified facts

- **EasyTrack is a standalone, non-proxy / immutable contract** (verified-contract ABI is direct
  logic, not a proxy). So event signatures are stable across the whole `active_from_block`→now
  history — no multi-variant decode is needed (contrast Dual Governance's two `ProposalSubmitted`).
- **Inheritance:** `Pausable, AccessControl, MotionSettings, EVMScriptFactoriesRegistry` — so the
  settings events (`MotionDurationChanged` / `ObjectionsThresholdChanged` / `MotionsCountLimitChanged`)
  and `EVMScriptExecutorChanged` are emitted by the same address as the motion lifecycle. All nine are
  ingested.
- **`MotionObjected` arity confirmed** against the deployed ABI: five inputs
  `(_motionId indexed, _objector indexed, _weight, _newObjectionsAmount, _newObjectionsAmountPct)` —
  the `_newObjectionsAmountPct` field is present in the deployed contract, matching the vendored
  signature.
- **Event topic0 hashes** are locked in `abi/events.spec.ts` (CI-enforced). `MotionCreated` and
  `MotionEnacted` were additionally confirmed against real emitted logs (`abi/__fixtures__/real-logs.json`,
  decoded in `abi/decoder.real-fixtures.spec.ts`).

## Registered motion-factory set (snapshot for the EVMScript-action decoder)

The factory set is **data, not a constant**: the ingester archives each motion's `_evmScriptFactory`
from `MotionCreated`, and never hard-codes or filters by a factory list. This snapshot of
`EasyTrack.getEVMScriptFactories()` (2026-06-28) is recorded only so the later EVMScript-action decoder
knows which factory targets to cover; re-pull before the live backfill, as the set drifts over time.

**41 registered factories** (e.g. `0xfebd8fac16de88206d4b18764e826af38546afe0` — the factory carried
by the real `MotionCreated` fixture, motion 1049). Full list as of 2026-06-28:

```
0xfebd8fac16de88206d4b18764e826af38546afe0  0x7e8effab3083fb26ace6832bfca4c377905f97d7
0x9721c0f77e3ea40ed592b9dcf3032daf269c0306  0xf6b6e7997338c48ea3a8bcfa4bb64a315fda76f4
0xbd2b6dc189eefd51b273f5cb2d99ba1ce565fb8c  0x48c135ff690c2aa7f5b11c539104b5855a4f9252
0x200da0b6a9905a377cf8d469664c65db267009d1  0x00a3d6260f70b1660c8646ef25d0820effd7be60
0x00caaef11ec545b192f16313f53912e453c91458  0x22010d1747cafc370b1f1fbba61022a313c5693b
0x935cb3366faf2cfc415b2099d1f974fd27202b77  0x1f2b79fe297b7098875930bba6dd17068103897e
0xe1f6babb445f809b97e3505ea91749461050f780  0xbd08f9d6bf1d25cc7407e4855df1d46c2043b3ea
0x1f809d2cb72a5ab13778811742050eda876129b6  0xd30dc38edefc21875257e8a3123503075226e14b
0xf2476f967c826722f5505edfc4b2561a34033477  0x6b7863f2c7dee99d3b744fdaedbeb1aecc025535
0x6ab39a8be67d9305799c3f8fdfc95caf3150d17c  0xcaa3af7460e83e665eefec73a7a542e5005c9639
0xcbb418f6f9bfd3525ce6aade8f74ecfefe2db5c8  0x8b82c1546d47330335a48406cc3a50da732672e7
0xd75778b855886fc5e1ea7d6bfada9eb68b35c19d  0xe5656eee7eed02bde009d77c88247bc8271e26eb
0x7d509bff310d9460b1f613e4e40d342201a83ae4  0x589e298964b9181d9938b84bb034c3bb9024e2c0
0xe31a0599a6772bcf9b2bfc9e25cf941e793c9a7d  0x6e04aed774b7c89bb43721acdd7d03c872a51b69
0x0d2aefa542afa8d9d1ec35376068b88042fef5f6  0x161a4552a625844c822954c5acbac928ee0f399b
0xbc5642bdd6f2a54b01a75605aae9143525d97308  0xdfa0bc38113b6d53c2881573fd764ceeff468610
0xaf35a63a4114b7481589fdd9fdb3e35fd65faed7  0x6a4f33f05e7412a11100353724bb6a152cf0d305
0x6f5c0a5a824773e8f8285bc5aa59ea0aab2a6400  0x58a59ddc6aea9b1d5743d024e15dfa4badb56e37
0x4f716ad3cc7a3a5cda2359e5b2c84335c171dcde  0xf23559de8ab37ff7a154384b0822da867cfa7eac
0x17305db55c908e84c58bbdca57258a7d1f7eea7c  0x6b535f441f95046562406f4e2518d9ad7db2dc0d
0x37d9b09eda477a84e3913fcb4d032efb0bf9b62e
```
