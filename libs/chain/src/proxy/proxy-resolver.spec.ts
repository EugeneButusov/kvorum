import { describe, expect, it } from 'vitest';
import { renderMetrics } from '@libs/observability';
import { ProxyResolver } from './proxy-resolver.js';
import { STANDARD_PROXY_SLOTS } from './slots.js';
import type { RpcClient } from '../client/rpc-client.js';

const ZERO_32 = '0x' + '00'.repeat(32);
const PROXY_ADDR = '0x' + 'aa'.repeat(20);
const IMPL_ADDR = '0x' + 'bb'.repeat(20);
const MID_ADDR = '0x' + 'cc'.repeat(20);
const BEACON_ADDR = '0x' + 'dd'.repeat(20);

/** Pads a 20-byte address to a 32-byte right-aligned hex string (no 0x prefix). */
function pad20to32(addr: string): string {
  return '0x' + '00'.repeat(12) + addr.slice(2);
}

/** EIP-1967, EIP-1967-beacon, EIP-1822, OZ-ZeppelinOS slots in probe order. */
const [EIP1967_SLOT, BEACON_SLOT, EIP1822_SLOT, OZLEG_SLOT] = STANDARD_PROXY_SLOTS.map(
  (s) => s.slot,
);

interface QueuedCall {
  result: unknown;
}

/** Minimal RpcClient mock — dequeues responses in order. Throws when queue is empty. */
function makeClient(calls: QueuedCall[]): RpcClient {
  let index = 0;
  const captured: string[] = [];
  const client: RpcClient & { _captured: string[] } = {
    _captured: captured,
    async send<T>(method: string): Promise<T> {
      captured.push(method);
      const call = calls[index++];
      if (!call) throw new Error(`Unexpected call #${index} (${method}) — queue exhausted`);
      if (call.result instanceof Error) throw call.result;
      return call.result as T;
    },
    getHealth: () => ({ chainId: 1, providers: [] }),
    start: async () => {},
    stop: async () => {},
  };
  return client;
}

function ok(result: unknown): QueuedCall {
  return { result };
}
function err(message: string): QueuedCall {
  return { result: new Error(message) };
}

function makeResolver(rpcClient: RpcClient, overrides?: { maxDepth?: number }): ProxyResolver {
  return new ProxyResolver({ rpcClient, chainName: 'test', ...overrides });
}

async function readCounter(name: string, labels: Record<string, string>): Promise<number> {
  const text = await renderMetrics();
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    if (Object.entries(labels).every(([k, v]) => line.includes(`${k}="${v}"`))) {
      const m = line.match(/\}\s+([\d.]+)\s*$/);
      if (m) return parseFloat(m[1]!);
    }
  }
  return 0;
}

describe('ProxyResolver', () => {
  it('#1 — non-proxy (all slots return 0x0) → not_a_proxy', async () => {
    const client = makeClient([ok(ZERO_32), ok(ZERO_32), ok(ZERO_32), ok(ZERO_32)]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result).toEqual({
      implementation: null,
      path: [],
      capped: false,
      reason: 'not_a_proxy',
    });
  });

  it('#2 — EIP-1967 single hop → resolved', async () => {
    const implPadded = pad20to32(IMPL_ADDR);
    // proxy: eip1967 slot → impl; impl: all slots → zero
    const client = makeClient([
      ok(implPadded), // proxy eth_getStorageAt eip1967 → impl
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32), // impl: all four slots → zero
    ]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result.reason).toBe('resolved');
    expect(result.implementation).toBe(IMPL_ADDR);
    expect(result.path).toHaveLength(1);
    expect(result.path[0]!.kind).toBe('eip1967');
    expect(result.path[0]!.proxyAddress).toBe(PROXY_ADDR);
    expect(result.capped).toBe(false);
  });

  it('#3 — EIP-1822 (UUPS) single hop → resolved', async () => {
    const implPadded = pad20to32(IMPL_ADDR);
    // proxy: eip1967 → zero, beacon → zero, eip1822 → impl; impl: all → zero
    const client = makeClient([
      ok(ZERO_32),
      ok(ZERO_32),
      ok(implPadded), // proxy slots
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32), // impl slots
    ]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result.reason).toBe('resolved');
    expect(result.path[0]!.kind).toBe('eip1822');
  });

  it('#4 — OZ legacy ZeppelinOS slot → resolved', async () => {
    const implPadded = pad20to32(IMPL_ADDR);
    // proxy: eip1967 → zero, beacon → zero, eip1822 → zero, oz → impl; impl: all → zero
    const client = makeClient([
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
      ok(implPadded), // proxy slots
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32), // impl slots
    ]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result.reason).toBe('resolved');
    expect(result.path[0]!.kind).toBe('oz-zeppelinos');
  });

  it('#5 — two-level chain (proxy → proxy → impl) → path.length === 2, resolved', async () => {
    const midPadded = pad20to32(MID_ADDR);
    const implPadded = pad20to32(IMPL_ADDR);
    // proxy: eip1967 → mid; mid: eip1967 → impl; impl: all → zero
    const client = makeClient([
      ok(midPadded), // proxy eip1967 → mid
      ok(implPadded), // mid eip1967 → impl
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32), // impl: all → zero
    ]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result.reason).toBe('resolved');
    expect(result.implementation).toBe(IMPL_ADDR);
    expect(result.path).toHaveLength(2);
    expect(result.path[0]!.proxyAddress).toBe(PROXY_ADDR);
    expect(result.path[1]!.proxyAddress).toBe(MID_ADDR);
  });

  it('#6 — recursion cap (maxDepth: 1) on two-level chain → capped, deepest hop', async () => {
    const midPadded = pad20to32(MID_ADDR);
    // proxy: eip1967 → mid; then depth cap hit before probing mid
    const client = makeClient([ok(midPadded)]);
    const result = await makeResolver(client, { maxDepth: 1 }).resolve(PROXY_ADDR);
    expect(result.reason).toBe('capped');
    expect(result.capped).toBe(true);
    expect(result.implementation).toBe(MID_ADDR);
    expect(result.path).toHaveLength(1);
  });

  it('#7 — cycle (A → B → A) → cycle, implementation null', async () => {
    const bPadded = pad20to32('0x' + 'bb'.repeat(20));
    const aPadded = pad20to32(PROXY_ADDR);
    // proxy(A): eip1967 → B; B: eip1967 → A (cycle)
    const client = makeClient([
      ok(bPadded), // A eip1967 → B
      ok(aPadded), // B eip1967 → A (cycle detected)
    ]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result.reason).toBe('cycle');
    expect(result.implementation).toBeNull();
  });

  it('#8 — beacon hop resolves via eth_call → resolved', async () => {
    const beaconPadded = pad20to32(BEACON_ADDR);
    const implPadded = pad20to32(IMPL_ADDR);
    // proxy: eip1967 → zero, beacon slot → beacon; eth_call beacon → impl; impl: all → zero
    const client = makeClient([
      ok(ZERO_32), // proxy eip1967 → zero
      ok(beaconPadded), // proxy beacon slot → beacon address
      // eth_call to beacon.implementation()
      ok(implPadded), // beacon impl → impl
      // impl: all slots → zero
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
    ]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result.reason).toBe('resolved');
    expect(result.implementation).toBe(IMPL_ADDR);
    expect(result.path[0]!.kind).toBe('eip1967-beacon');
  });

  it('#9 — beacon with zero impl (broken beacon) → continues to next slot', async () => {
    const beaconPadded = pad20to32(BEACON_ADDR);
    const implPadded = pad20to32(IMPL_ADDR);
    // proxy: eip1967 → zero, beacon slot → beacon; eth_call → zero (broken), eip1822 → impl
    const client = makeClient([
      ok(ZERO_32), // proxy eip1967 → zero
      ok(beaconPadded), // proxy beacon slot → beacon address
      ok(ZERO_32), // eth_call beacon → zero (broken)
      ok(implPadded), // proxy eip1822 → impl
      // impl: all → zero
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
    ]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result.reason).toBe('resolved');
    expect(result.path[0]!.kind).toBe('eip1822');
  });

  it('#10 — RPC failure on first slot → falls through to second slot', async () => {
    const implPadded = pad20to32(IMPL_ADDR);
    // proxy: eip1967 throws, beacon slot → zero, eip1822 → impl; impl: all → zero
    const client = makeClient([
      err('connection reset'), // proxy eip1967 → error
      ok(ZERO_32), // proxy beacon slot → zero
      ok(implPadded), // proxy eip1822 → impl
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32),
      ok(ZERO_32), // impl: all → zero
    ]);
    const result = await makeResolver(client).resolve(PROXY_ADDR);
    expect(result.reason).toBe('resolved');
    expect(result.path[0]!.kind).toBe('eip1822');
  });

  it('#11 — all RPC failures at depth 0 → all_slots_failed, warn logged', async () => {
    const warnMessages: string[] = [];
    const client = makeClient([err('timeout'), err('timeout'), err('timeout'), err('timeout')]);
    const resolver = new ProxyResolver({
      rpcClient: client,
      chainName: 'test',
      logger: {
        debug: () => {},
        info: () => {},
        warn: (msg) => {
          warnMessages.push(msg);
        },
        error: () => {},
      },
    });
    const result = await resolver.resolve(PROXY_ADDR);
    expect(result.reason).toBe('all_slots_failed');
    expect(result.implementation).toBeNull();
    expect(result.path).toHaveLength(0);
    expect(warnMessages.some((m) => m.includes('all slot probes failed'))).toBe(true);
  });

  it('#11b — all RPC failures at non-root depth → all_slots_failed (no false-positive resolved)', async () => {
    // proxy: eip1967 → mid (succeeds); mid: all 4 slot probes throw
    const midPadded = pad20to32(MID_ADDR);
    const warnMessages: string[] = [];
    const client = makeClient([
      ok(midPadded), // proxy eip1967 → mid (depth 0)
      err('timeout'),
      err('timeout'),
      err('timeout'),
      err('timeout'), // mid: all four slot probes fail (depth 1)
    ]);
    const resolver = new ProxyResolver({
      rpcClient: client,
      chainName: 'test',
      logger: {
        debug: () => {},
        info: () => {},
        warn: (msg) => {
          warnMessages.push(msg);
        },
        error: () => {},
      },
    });
    const result = await resolver.resolve(PROXY_ADDR);
    expect(result.reason).toBe('all_slots_failed');
    expect(result.implementation).toBeNull();
    // The intermediate proxy step is preserved so callers see how far the walk got.
    expect(result.path).toHaveLength(1);
    expect(result.path[0]!.proxyAddress).toBe(PROXY_ADDR);
    expect(warnMessages.some((m) => m.includes('all slot probes failed'))).toBe(true);
  });

  it('#12 — address normalisation — mixed-case input is lowercased in path', async () => {
    const implPadded = pad20to32(IMPL_ADDR);
    const client = makeClient([ok(implPadded), ok(ZERO_32), ok(ZERO_32), ok(ZERO_32), ok(ZERO_32)]);
    const mixed = PROXY_ADDR.replace(/aa/g, 'Aa');
    const result = await makeResolver(client).resolve(mixed);
    expect(result.path[0]!.proxyAddress).toBe(PROXY_ADDR);
  });

  it('#13 — metric increment — proxyResolutions increments once with correct result label', async () => {
    const before = await readCounter('test_ingestion_proxy_resolutions_total', {
      chain: 'test',
      result: 'not_a_proxy',
    });
    const client = makeClient([ok(ZERO_32), ok(ZERO_32), ok(ZERO_32), ok(ZERO_32)]);
    await makeResolver(client).resolve(PROXY_ADDR);
    const after = await readCounter('test_ingestion_proxy_resolutions_total', {
      chain: 'test',
      result: 'not_a_proxy',
    });
    expect(after - before).toBe(1);
  });

  it('#13b — metric label is cycle when a cycle is detected', async () => {
    const before = await readCounter('test_ingestion_proxy_resolutions_total', {
      chain: 'test',
      result: 'cycle',
    });
    const bPadded = pad20to32('0x' + 'bb'.repeat(20));
    const aPadded = pad20to32(PROXY_ADDR);
    const client = makeClient([ok(bPadded), ok(aPadded)]);
    await makeResolver(client).resolve(PROXY_ADDR);
    const after = await readCounter('test_ingestion_proxy_resolutions_total', {
      chain: 'test',
      result: 'cycle',
    });
    expect(after - before).toBe(1);
  });

  // Verify slot constants are set correctly (sanity check)
  it('STANDARD_PROXY_SLOTS has correct EIP-1967 slot value', () => {
    expect(EIP1967_SLOT).toBe('0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc');
  });

  it('STANDARD_PROXY_SLOTS has correct EIP-1822 slot value (no - 1)', () => {
    expect(EIP1822_SLOT).toBe('0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7');
  });

  it('BEACON_SLOT constant matches plan', () => {
    expect(BEACON_SLOT).toBe('0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50');
  });

  it('OZLEG_SLOT constant matches plan', () => {
    expect(OZLEG_SLOT).toBe('0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3');
  });
});
