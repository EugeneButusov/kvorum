import { Interface } from 'ethers';
import { describe, it, expect } from 'vitest';
import { toProposalActions } from './evmscript-actions';
import { createForwarderRegistry } from './forwarders';
import { FORWARD_SELECTOR } from './forwarders';

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

const AGENT = '0x3e40d73eb977dc6a537af587d48316fee66e9c8c';
const A = '0x' + 'aa'.repeat(20);
const B = '0x' + 'bb'.repeat(20);
const C = '0x' + 'cc'.repeat(20);
const D = '0x' + 'dd'.repeat(20);
const CHAIN_ID = '0x1';

describe('toProposalActions', () => {
  it('empty script → []', () => {
    expect(toProposalActions('0x', CHAIN_ID)).toEqual([]);
    expect(toProposalActions('', CHAIN_ID)).toEqual([]);
    expect(toProposalActions('0x00000001', CHAIN_ID)).toEqual([]);
  });

  it('flat 3-call script → 3 actions in order', () => {
    const script = buildScript([
      { to: A, calldata: '0x11111111' },
      { to: B, calldata: '0x22222222' },
      { to: C, calldata: '0x33333333' },
    ]);
    const actions = toProposalActions(script, CHAIN_ID);
    expect(actions).toHaveLength(3);
    expect(actions[0]?.targetAddress).toBe(A);
    expect(actions[1]?.targetAddress).toBe(B);
    expect(actions[2]?.targetAddress).toBe(C);
    expect(actions[0]?.valueWei).toBe('0');
    expect(actions[0]?.functionSignature).toBeNull();
    expect(actions[0]?.targetChainId).toBe(CHAIN_ID);
  });

  it('Agent.forward(nested 4-call) → 4 ordered leaves', () => {
    const nestedScript = buildScript([
      { to: A, calldata: '0xaabbccdd' },
      { to: B, calldata: '0xbbbbbbbb' },
      { to: C, calldata: '0xcccccccc' },
      { to: D, calldata: '0xdddddddd' },
    ]);
    const outerScript = buildScript([{ to: AGENT, calldata: encodeForward(nestedScript) }]);
    const actions = toProposalActions(outerScript, CHAIN_ID);
    expect(actions).toHaveLength(4);
    expect(actions[0]?.targetAddress).toBe(A);
    expect(actions[1]?.targetAddress).toBe(B);
    expect(actions[2]?.targetAddress).toBe(C);
    expect(actions[3]?.targetAddress).toBe(D);
  });

  it('multi-level nest: forward([forward([B,C])]) inside flat list → B,C expanded', () => {
    const innerScript = buildScript([
      { to: B, calldata: '0xbbbbbbbb' },
      { to: C, calldata: '0xcccccccc' },
    ]);
    const midScript = buildScript([{ to: AGENT, calldata: encodeForward(innerScript) }]);
    const outerScript = buildScript([
      { to: A, calldata: '0xaaaaaaaa' },
      { to: AGENT, calldata: encodeForward(midScript) },
      { to: D, calldata: '0xdddddddd' },
    ]);
    const actions = toProposalActions(outerScript, CHAIN_ID);
    expect(actions).toHaveLength(4);
    expect(actions[0]?.targetAddress).toBe(A);
    expect(actions[1]?.targetAddress).toBe(B);
    expect(actions[2]?.targetAddress).toBe(C);
    expect(actions[3]?.targetAddress).toBe(D);
  });

  it('mixed tree [A, forward([B,C]), D] → [A,B,C,D] canonical ordering', () => {
    const nestedScript = buildScript([
      { to: B, calldata: '0xbbbbbbbb' },
      { to: C, calldata: '0xcccccccc' },
    ]);
    const script = buildScript([
      { to: A, calldata: '0xaaaaaaaa' },
      { to: AGENT, calldata: encodeForward(nestedScript) },
      { to: D, calldata: '0xdddddddd' },
    ]);
    const actions = toProposalActions(script, CHAIN_ID);
    expect(actions).toHaveLength(4);
    expect(actions[0]?.targetAddress).toBe(A);
    expect(actions[1]?.targetAddress).toBe(B);
    expect(actions[2]?.targetAddress).toBe(C);
    expect(actions[3]?.targetAddress).toBe(D);
  });

  it('Agent.execute carries non-zero ETH value', () => {
    const target = '0x' + 'ab'.repeat(20);
    const value = 5n * 10n ** 17n; // 0.5 ETH
    const data = '0xdeadbeef';
    const executeCalldata = encodeExecute(target, value, data);
    const script = buildScript([{ to: AGENT, calldata: executeCalldata }]);
    const actions = toProposalActions(script, CHAIN_ID);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.targetAddress).toBe(target.toLowerCase());
    expect(actions[0]?.valueWei).toBe(value.toString());
    expect(actions[0]?.calldata).toBe(data);
  });

  it('determinism: same input twice → deep-equal', () => {
    const nestedScript = buildScript([
      { to: A, calldata: '0xaabbccdd' },
      { to: B, calldata: '0xbbbbbbbb' },
    ]);
    const script = buildScript([
      { to: AGENT, calldata: encodeForward(nestedScript) },
      { to: C, calldata: '0xcccccccc' },
    ]);
    const first = toProposalActions(script, CHAIN_ID);
    const second = toProposalActions(script, CHAIN_ID);
    expect(first).toEqual(second);
  });

  it('accepts a custom registry (extensibility)', () => {
    const CUSTOM_FORWARDER = '0x' + 'ee'.repeat(20);
    const customRegistry = createForwarderRegistry([
      { address: CUSTOM_FORWARDER, selectors: [FORWARD_SELECTOR] },
    ]);
    const nestedScript = buildScript([{ to: A, calldata: '0xaabbccdd' }]);
    const script = buildScript([{ to: CUSTOM_FORWARDER, calldata: encodeForward(nestedScript) }]);
    const actions = toProposalActions(script, CHAIN_ID, customRegistry);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.targetAddress).toBe(A);
  });
});
