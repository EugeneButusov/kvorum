/**
 * Developer-side script to regenerate compound-emitter.bytecode.ts.
 * Run with: node apps/indexer/scripts/generate-bytecode.cjs
 * Requires: ethers in node_modules (already a project dep).
 *
 * Generates minimal EVM bytecode for CompoundEmitter (emitValid + emitMalformed).
 * Does NOT require a Solidity compiler — bytecode is constructed from EVM opcodes.
 * The Solidity source (CompoundEmitter.sol) is the canonical reference; this script
 * produces the equivalent on-chain behaviour without the solc toolchain.
 */

'use strict';
const { writeFileSync } = require('fs');
const { join } = require('path');
const { ethers } = require('ethers');

// ── 1. Compute selectors and topic ─────────────────────────────────────────
const fnIface = new ethers.Interface(['function emitValid()', 'function emitMalformed()']);
const emitValidSel = fnIface.getFunction('emitValid').selector.slice(2); // 8 hex chars
const emitMalformedSel = fnIface.getFunction('emitMalformed').selector.slice(2);

const evtIface = new ethers.Interface([
  'event ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
]);
const topic = evtIface.getEvent('ProposalCreated').topicHash.slice(2); // 64 hex chars

// ── 2. ABI-encode valid ProposalCreated event data ──────────────────────────
const coder = ethers.AbiCoder.defaultAbiCoder();
const validDataHex = coder
  .encode(
    [
      'uint256',
      'address',
      'address[]',
      'uint256[]',
      'string[]',
      'bytes[]',
      'uint256',
      'uint256',
      'string',
    ],
    [
      1n,
      '0x0000000000000000000000000000000000000001',
      ['0x0000000000000000000000000000000000000002'],
      [0n],
      [''],
      ['0x'],
      100n,
      200n,
      '',
    ],
  )
  .slice(2); // remove 0x prefix

const validDataLen = validDataHex.length / 2;

// ── 3. Compute layout constants ─────────────────────────────────────────────
//
// Runtime layout:
//   [0..27]           Dispatcher (28 bytes)
//   [28..77]          emitValid code (50 bytes)
//   [78..117]         emitMalformed code (40 bytes)
//   [118..118+dataLen-1]  ABI-encoded valid event data
//
const DISPATCHER_SIZE = 28;
const EMIT_VALID_SIZE = 50;
const EMIT_MALFORMED_SIZE = 40;

const emitValidPc = DISPATCHER_SIZE; // 28
const emitMalformedPc = DISPATCHER_SIZE + EMIT_VALID_SIZE; // 78
const dataCodeOffset = DISPATCHER_SIZE + EMIT_VALID_SIZE + EMIT_MALFORMED_SIZE; // 118
const runtimeSize = dataCodeOffset + validDataLen;

// ── 4. Helper: push N bytes ─────────────────────────────────────────────────
function p1(val) {
  return '60' + val.toString(16).padStart(2, '0');
}
function p2(val) {
  return '61' + val.toString(16).padStart(4, '0');
}
function p4(hexStr) {
  return '63' + hexStr;
} // hexStr is 8 chars (4 bytes)
function p32(hexStr) {
  return '7f' + hexStr.padStart(64, '0');
} // hexStr is 64 chars (32 bytes)

// ── 5. Build runtime bytecode ────────────────────────────────────────────────
let runtime = '';

// --- Dispatcher ---
// selector = CALLDATALOAD(0) >> 224
runtime += p1(0x00); // PUSH1 0
runtime += '35'; // CALLDATALOAD
runtime += p1(0xe0); // PUSH1 0xe0
runtime += '1c'; // SHR → stack: [selector]
// Compare to emitValid
runtime += '80'; // DUP1 → [selector, selector]
runtime += p4(emitValidSel); // PUSH4
runtime += '14'; // EQ → [(sel==emitValid), selector]
runtime += p2(emitValidPc); // PUSH2 dest
runtime += '57'; // JUMPI → if match, jump; stack: [selector]
// Compare to emitMalformed
runtime += p4(emitMalformedSel); // PUSH4
runtime += '14'; // EQ → [(sel==emitMalformed)]
runtime += p2(emitMalformedPc); // PUSH2 dest
runtime += '57'; // JUMPI
// Fallback STOP
runtime += '00'; // STOP

// Sanity check
if (runtime.length / 2 !== DISPATCHER_SIZE) {
  throw new Error(
    `Dispatcher size mismatch: expected ${DISPATCHER_SIZE}, got ${runtime.length / 2}`,
  );
}

// --- emitValid ---
// CODECOPY to load ABI-encoded data into memory[0..dataLen-1], then LOG1
runtime += '5b'; // JUMPDEST (emitValidPc=28)
runtime += p2(validDataLen); // PUSH2 size
runtime += p2(dataCodeOffset); // PUSH2 codeOffset
runtime += p1(0x00); // PUSH1 0 (memDest)
runtime += '39'; // CODECOPY
runtime += p32(topic); // PUSH32 topic
runtime += p2(validDataLen); // PUSH2 size
runtime += p1(0x00); // PUSH1 0 (memOffset)
runtime += 'a1'; // LOG1
runtime += '00'; // STOP

if (runtime.length / 2 !== DISPATCHER_SIZE + EMIT_VALID_SIZE) {
  throw new Error(
    `emitValid size mismatch: expected ${DISPATCHER_SIZE + EMIT_VALID_SIZE}, got ${runtime.length / 2}`,
  );
}

// --- emitMalformed ---
// Memory[0..7] is 0x0000000000000000 (EVM memory is zero-initialised).
// LOG1(0, 8, topic) emits 8 garbage bytes — too short to ABI-decode ProposalCreated.
runtime += '5b'; // JUMPDEST (emitMalformedPc=78)
runtime += p32(topic); // PUSH32 topic
runtime += p1(0x08); // PUSH1 8
runtime += p1(0x00); // PUSH1 0
runtime += 'a1'; // LOG1
runtime += '00'; // STOP

if (runtime.length / 2 !== DISPATCHER_SIZE + EMIT_VALID_SIZE + EMIT_MALFORMED_SIZE) {
  throw new Error(`emitMalformed size mismatch`);
}

// --- Append ABI-encoded data ---
runtime += validDataHex;

if (runtime.length / 2 !== runtimeSize) {
  throw new Error(`runtime size mismatch: expected ${runtimeSize}, got ${runtime.length / 2}`);
}

// ── 6. Build deploy bytecode (constructor) ──────────────────────────────────
//
// Constructor (14 bytes):
//   PUSH2 runtimeSize   ; size to copy
//   PUSH1 0x0e          ; code offset = 14 (past the constructor)
//   PUSH1 0x00          ; memory destination
//   CODECOPY
//   PUSH2 runtimeSize   ; size to return
//   PUSH1 0x00          ; memory offset
//   RETURN
//
const CONSTRUCTOR_SIZE = 14;
let deploy = '';
deploy += p2(runtimeSize); // PUSH2 runtimeSize
deploy += p1(CONSTRUCTOR_SIZE); // PUSH1 0x0e
deploy += p1(0x00); // PUSH1 0x00
deploy += '39'; // CODECOPY
deploy += p2(runtimeSize); // PUSH2 runtimeSize
deploy += p1(0x00); // PUSH1 0x00
deploy += 'f3'; // RETURN

if (deploy.length / 2 !== CONSTRUCTOR_SIZE) {
  throw new Error(
    `Constructor size mismatch: expected ${CONSTRUCTOR_SIZE}, got ${deploy.length / 2}`,
  );
}

deploy += runtime;

// ── 7. Output TypeScript constants ──────────────────────────────────────────
const out = `// AUTO-GENERATED by apps/indexer/scripts/generate-bytecode.cjs
// Do NOT edit by hand — run: node apps/indexer/scripts/generate-bytecode.cjs
// See apps/indexer/tests/_fixtures/README.md for regeneration instructions.

/** EVM deploy bytecode (constructor + runtime). Pass as \`data\` in eth_sendTransaction. */
export const COMPOUND_EMITTER_DEPLOY_BYTECODE = '0x${deploy}';

/** EVM runtime bytecode only (after deployment). */
export const COMPOUND_EMITTER_RUNTIME_BYTECODE = '0x${runtime}';

/** 4-byte selector for emitValid() */
export const EMIT_VALID_SELECTOR = '${emitValidSel}';

/** 4-byte selector for emitMalformed() */
export const EMIT_MALFORMED_SELECTOR = '${emitMalformedSel}';

/** keccak256 topic hash for ProposalCreated (without 0x prefix) */
export const PROPOSAL_CREATED_TOPIC = '0x${topic}';
`;

const outPath = join(__dirname, '../tests/_fixtures/compound-emitter.bytecode.ts');
writeFileSync(outPath, out, 'utf8');

console.log('Generated', outPath);
console.log('emitValidSel:', emitValidSel);
console.log('emitMalformedSel:', emitMalformedSel);
console.log('proposalCreatedTopic:', topic);
console.log('validDataLen:', validDataLen, 'bytes');
console.log('runtimeSize:', runtimeSize, 'bytes');
console.log('deploySize:', deploy.length / 2, 'bytes');
