# EVMScript decoder fixtures

## Decoder contract

These fixtures exercise the CallsScript (spec 1) decoder defined in
`libs/sources/core/src/calldata/evmscript.ts` and the Lido forwarder layer in
`libs/sources/lido/src/calldata/`.

**Wire format (spec_id = 0x00000001)**

```
0x00000001                 4 bytes  — spec id
repeated until end:
  to              20 bytes — call target address
  calldataLength   4 bytes — uint32 big-endian (counts selector + args)
  calldata         N bytes — full calldata INCLUDING the 4-byte selector
```

No value field; every plain-CallsScript leaf executes with msg.value = 0.
`Agent.execute(_target, _ethValue, _data)` is the only path that carries ETH.

**Forwarder recursion:** `Agent.forward(bytes _evmScript)` and
`Agent.execute(address, uint256, bytes)` are unwrapped recursively (depth ≤ 8)
to produce flattened leaf actions. This diverges deliberately from Lido's own
`evm-script-decoder` (a display tool that does not recurse); here we need
flattened `proposal_action` leaves.

## Acceptance criterion

**≥ 95 % of non-empty executionScripts parse structurally** — this measures
whether `decodeEvmScript` + `unwrapCall` can parse a real Lido on-chain vote
script without throwing or degrading to an opaque leaf. It is independent of
inner-calldata ABI resolution (§3.8 / AA4).

- Empty scripts (`0x` or bare spec id) are a separate bucket (100% trivial).
- The ≥ 95 % denominator excludes empty scripts.
- Each non-empty fixture also asserts a leaf count verified against an
  independent oracle (see `countProvenance` field in each JSON).

## Honesty note

This is a **curated in-protocol sample**: vote IDs were hand-selected to cover
eras (pre-LIP-21, post-LIP-21) and complexity (empty, flat, omnibus with
Agent.forward nesting, Agent.execute with ETH value). It is not a random sample
of all 200+ Lido votes. The ≥ 95 % is meaningful only in the context of this
curated set and is intended to catch decoder regressions, not to measure the
breadth of protocol usage.

## Fixture schema

Each `scripts/*.json` file:

```jsonc
{
  "voteId": 42,
  "kind": "empty" | "flat" | "omnibus" | "execute",
  "script": "0x...",           // raw EVMScript hex from getVote(voteId).script
  "expectedLeafActionCount": 3, // null for empty kind
  "countProvenance": "..."      // how expectedLeafActionCount was verified
}
```

**kind tags:**

- `empty` — script is `0x` or bare spec id → `[]`
- `flat` — no forwarder calls; direct leaf actions only
- `omnibus` — contains ≥ 1 `Agent.forward(bytes)` recursion
- `execute` — contains `Agent.execute(address, uint256, bytes)` with non-zero ETH

## Capture

Fixtures were captured with `capture.ts` using a mainnet RPC (`eth_call` at
latest). No archive node required — closed vote scripts are immutable in
current storage. The `getVote` ABI fragment is era-matched (LIP-21 impl returns
11 fields including `phase`; pre-objection eras return 10 fields).
