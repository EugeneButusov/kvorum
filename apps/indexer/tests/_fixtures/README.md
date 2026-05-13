# Test fixtures — CompoundEmitter

This directory contains the `CompoundEmitter` EVM contract used by F3a and F3b integration tests.

## Files

| File                                  | Description                                                        |
| ------------------------------------- | ------------------------------------------------------------------ |
| `CompoundEmitter.sol`                 | Canonical Solidity source (reference only — not compiled in CI)    |
| `compound-emitter.bytecode.ts`        | Pre-compiled deploy/runtime bytecode + selectors (checked in)      |
| `../../scripts/generate-bytecode.cjs` | Developer-side generator — produces `compound-emitter.bytecode.ts` |

## Regenerating the bytecode

The bytecode in `compound-emitter.bytecode.ts` is generated from EVM opcodes using the project's
existing ethers.js dependency. No Solidity toolchain is required in CI.

To regenerate (e.g. after changing ABI parameters):

```bash
node apps/indexer/scripts/generate-bytecode.cjs
```

The script uses `ethers.AbiCoder` to compute the ABI-encoded ProposalCreated data and constructs
minimal EVM bytecode (dispatcher + emitValid + emitMalformed + embedded ABI data) by hand.

The Solidity source (`CompoundEmitter.sol`) is the canonical design reference — if the contract
logic changes, update `generate-bytecode.cjs` to match, regenerate, and verify the integration
tests pass.
