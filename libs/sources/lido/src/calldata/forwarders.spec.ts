import { Interface, keccak256, toUtf8Bytes } from 'ethers';
import { describe, expect, it } from 'vitest';
import type { EvmScriptCall } from '@sources/core';
import {
  EXECUTE_SELECTOR,
  FORWARD_SELECTOR,
  createForwarderRegistry,
  unwrapCall,
} from './forwarders';

// Helper: compute selector for assertion
function sel(sig: string): string {
  return keccak256(toUtf8Bytes(sig)).slice(0, 10).toLowerCase();
}

// Helper: encode forward(bytes) calldata
const FORWARD_IFACE = new Interface(['function forward(bytes _evmScript)']);
const EXECUTE_IFACE = new Interface([
  'function execute(address _target, uint256 _ethValue, bytes _data)',
]);

function encodeForward(script: string): string {
  return FORWARD_IFACE.encodeFunctionData('forward', [script]);
}

function encodeExecute(target: string, value: bigint, data: string): string {
  return EXECUTE_IFACE.encodeFunctionData('execute', [target, value, data]);
}

// Build a minimal CallsScript for use as nested EVMScript
function buildScript(calls: Array<{ to: string; calldata: string }>): string {
  const parts: Buffer[] = [Buffer.from('00000001', 'hex')];
  for (const { to, calldata } of calls) {
    const toBytes = Buffer.from(to.replace('0x', ''), 'hex');
    const cdBytes = Buffer.from(calldata.replace('0x', ''), 'hex');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(cdBytes.length, 0);
    parts.push(toBytes, lenBuf, cdBytes);
  }
  return '0x' + Buffer.concat(parts).toString('hex');
}

// Known mainnet forwarder addresses
const AGENT = '0x3e40d73eb977dc6a537af587d48316fee66e9c8c';
const TOKEN_MANAGER = '0xf73a1260d222f447210581ddf212d915c09a3249';
const VOTING = '0x2e59a20f205bb85a89c53f1936454680651e618e';
const NON_FORWARDER = '0x' + '11'.repeat(20);
const CHAIN_ID = '0x1';

const registry = createForwarderRegistry();

const FORWARD_IFACE_CHECK = new Interface(['function forward(bytes _evmScript)']);
const EXECUTE_IFACE_CHECK = new Interface([
  'function execute(address _target, uint256 _ethValue, bytes _data)',
]);

describe('forwarder selectors', () => {
  it('FORWARD_SELECTOR matches ethers Interface selector for forward(bytes)', () => {
    expect(FORWARD_SELECTOR).toBe(
      FORWARD_IFACE_CHECK.getFunction('forward')!.selector.toLowerCase(),
    );
    expect(FORWARD_SELECTOR).toBe(sel('forward(bytes)'));
  });

  it('EXECUTE_SELECTOR matches keccak256 of execute(address,uint256,bytes)', () => {
    expect(EXECUTE_SELECTOR).toBe(
      EXECUTE_IFACE_CHECK.getFunction('execute')!.selector.toLowerCase(),
    );
    expect(EXECUTE_SELECTOR).toBe(sel('execute(address,uint256,bytes)'));
    expect(EXECUTE_SELECTOR).toBe('0xb61d27f6');
  });
});

describe('createForwarderRegistry', () => {
  it('recognizes Agent as a forward forwarder', () => {
    const entry = registry.get(AGENT);
    expect(entry).toBeDefined();
    expect(entry?.selectors.has(FORWARD_SELECTOR)).toBe(true);
  });

  it('recognizes Agent as an execute forwarder', () => {
    const entry = registry.get(AGENT);
    expect(entry?.selectors.has(EXECUTE_SELECTOR)).toBe(true);
  });

  it('recognizes TokenManager as a forward forwarder', () => {
    const entry = registry.get(TOKEN_MANAGER);
    expect(entry?.selectors.has(FORWARD_SELECTOR)).toBe(true);
  });

  it('recognizes Voting as a forward forwarder', () => {
    const entry = registry.get(VOTING);
    expect(entry?.selectors.has(FORWARD_SELECTOR)).toBe(true);
  });

  it('returns undefined for non-forwarder address', () => {
    expect(registry.get(NON_FORWARDER)).toBeUndefined();
  });

  it('is case-insensitive for lookup', () => {
    expect(registry.get(AGENT.toUpperCase())).toBeDefined();
    expect(registry.get(AGENT)).toBeDefined();
  });

  it('external registration via extra param (AC reuse)', () => {
    const CUSTOM = '0x' + 'ff'.repeat(20);
    const extRegistry = createForwarderRegistry([
      { address: CUSTOM, selectors: [FORWARD_SELECTOR] },
    ]);
    const entry = extRegistry.get(CUSTOM);
    expect(entry).toBeDefined();
    expect(entry?.selectors.has(FORWARD_SELECTOR)).toBe(true);
    // default entries still present
    expect(extRegistry.get(AGENT)).toBeDefined();
  });
});

describe('unwrapCall', () => {
  it('non-forwarder address → opaque leaf with valueWei=0', () => {
    const call: EvmScriptCall = { to: NON_FORWARDER, calldata: '0x12345678' };
    const result = unwrapCall(call, CHAIN_ID, registry);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      targetAddress: NON_FORWARDER,
      targetChainId: CHAIN_ID,
      valueWei: '0',
      functionSignature: null,
      calldata: '0x12345678',
    });
  });

  it('same selector on non-forwarder address → opaque (address-gating)', () => {
    // forward selector on a random address should NOT recurse
    const forwardCalldata = encodeForward(
      buildScript([{ to: '0x' + 'ab'.repeat(20), calldata: '0xdeadbeef' }]),
    );
    const call: EvmScriptCall = { to: NON_FORWARDER, calldata: forwardCalldata };
    const result = unwrapCall(call, CHAIN_ID, registry);
    expect(result).toHaveLength(1);
    expect(result[0]?.targetAddress).toBe(NON_FORWARDER);
  });

  it('Agent.forward(nested 1-call script) → 1 leaf from inner call', () => {
    const innerTarget = '0x' + 'ab'.repeat(20);
    const innerCalldata = '0x12345678aabbccdd';
    const nestedScript = buildScript([{ to: innerTarget, calldata: innerCalldata }]);
    const forwardCalldata = encodeForward(nestedScript);
    const call: EvmScriptCall = { to: AGENT, calldata: forwardCalldata };
    const result = unwrapCall(call, CHAIN_ID, registry);
    expect(result).toHaveLength(1);
    expect(result[0]?.targetAddress).toBe(innerTarget);
    expect(result[0]?.calldata).toBe(innerCalldata);
    expect(result[0]?.valueWei).toBe('0');
    expect(result[0]?.functionSignature).toBeNull();
  });

  it('Agent.forward(nested 4-call script) → 4 ordered leaves', () => {
    const targets = ['aa', 'bb', 'cc', 'dd'].map((x) => '0x' + x.repeat(20));
    const cds = ['0x11111111', '0x22222222', '0x33333333', '0x44444444'];
    const nestedScript = buildScript(targets.map((to, i) => ({ to, calldata: cds[i] ?? '0x' })));
    const forwardCalldata = encodeForward(nestedScript);
    const call: EvmScriptCall = { to: AGENT, calldata: forwardCalldata };
    const result = unwrapCall(call, CHAIN_ID, registry);
    expect(result).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(result[i]?.targetAddress).toBe(targets[i]);
    }
  });

  it('multi-level nest: forward([forward([B,C])]) → [B,C] in order', () => {
    const B = '0x' + 'bb'.repeat(20);
    const C = '0x' + 'cc'.repeat(20);
    const innerScript = buildScript([
      { to: B, calldata: '0xbbbbbbbb' },
      { to: C, calldata: '0xcccccccc' },
    ]);
    const midScript = buildScript([{ to: AGENT, calldata: encodeForward(innerScript) }]);
    const outerCalldata = encodeForward(midScript);
    const call: EvmScriptCall = { to: AGENT, calldata: outerCalldata };
    const result = unwrapCall(call, CHAIN_ID, registry);
    expect(result).toHaveLength(2);
    expect(result[0]?.targetAddress).toBe(B);
    expect(result[1]?.targetAddress).toBe(C);
  });

  it('Agent.execute with non-zero value → leaf with decimal valueWei', () => {
    const target = '0x' + 'ab'.repeat(20);
    const value = 10n ** 18n; // 1 ETH
    const data = '0xdeadbeef';
    const executeCalldata = encodeExecute(target, value, data);
    const call: EvmScriptCall = { to: AGENT, calldata: executeCalldata };
    const result = unwrapCall(call, CHAIN_ID, registry);
    expect(result).toHaveLength(1);
    expect(result[0]?.targetAddress).toBe(target.toLowerCase());
    expect(result[0]?.valueWei).toBe(value.toString());
    expect(result[0]?.calldata).toBe(data);
  });

  it('Agent.execute value is base-10 decimal string (not hex)', () => {
    const executeCalldata = encodeExecute('0x' + 'ab'.repeat(20), 12345678901234567890n, '0x');
    const call: EvmScriptCall = { to: AGENT, calldata: executeCalldata };
    const result = unwrapCall(call, CHAIN_ID, registry);
    expect(result[0]?.valueWei).toBe('12345678901234567890');
    expect(result[0]?.valueWei).not.toMatch(/^0x/);
  });

  it('depth overflow at depth=8 → degrades to opaque leaf without throwing', () => {
    const innerTarget = '0x' + 'ab'.repeat(20);
    const nestedScript = buildScript([{ to: innerTarget, calldata: '0x12345678' }]);
    const forwardCalldata = encodeForward(nestedScript);
    const call: EvmScriptCall = { to: AGENT, calldata: forwardCalldata };
    // Call at max depth — should degrade to opaque
    const result = unwrapCall(call, CHAIN_ID, registry, 8);
    expect(result).toHaveLength(1);
    expect(result[0]?.targetAddress).toBe(AGENT);
  });

  it('malformed forward arg (not a valid EVMScript) → opaque leaf without throwing', () => {
    // Encode forward with invalid nested bytes
    const invalidScript = '0xdeadbeef'; // not a valid CallsScript
    const forwardCalldata = encodeForward(invalidScript);
    const call: EvmScriptCall = { to: AGENT, calldata: forwardCalldata };
    const result = unwrapCall(call, CHAIN_ID, registry);
    expect(result).toHaveLength(1);
    expect(result[0]?.targetAddress).toBe(AGENT);
  });
});
