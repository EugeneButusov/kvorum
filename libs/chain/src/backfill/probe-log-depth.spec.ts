import { describe, expect, it, vi } from 'vitest';
import { probeLogDepth } from './probe-log-depth.js';
import type { RpcClient } from '../client/rpc-client.js';

function makeRpc(handlers: Record<string, (params: unknown[]) => unknown>): RpcClient {
  return {
    send: vi.fn((method: string, params: unknown[]) => {
      const handler = handlers[method];
      if (handler == null) return Promise.reject(new Error(`unexpected method ${method}`));
      return Promise.resolve(handler(params));
    }),
  } as unknown as RpcClient;
}

describe('probeLogDepth', () => {
  it('passes when the block is served and getLogs succeeds', async () => {
    const rpc = makeRpc({
      eth_getBlockByNumber: () => ({ number: '0x64' }),
      eth_getLogs: () => [],
    });
    expect(await probeLogDepth({ rpcClient: rpc, address: '0xabc', fromBlock: 100n })).toEqual({
      ok: true,
    });
  });

  it('fails when the block is not served (pruned / non-archive provider)', async () => {
    const rpc = makeRpc({ eth_getBlockByNumber: () => null, eth_getLogs: () => [] });
    const result = await probeLogDepth({ rpcClient: rpc, address: '0xabc', fromBlock: 100n });
    expect(result.ok).toBe(false);
  });

  it('fails when getLogs rejects the historical range', async () => {
    const rpc = makeRpc({
      eth_getBlockByNumber: () => ({ number: '0x64' }),
      eth_getLogs: () => {
        throw new Error('missing trie node 0xdead');
      },
    });
    const result = await probeLogDepth({ rpcClient: rpc, address: '0xabc', fromBlock: 100n });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('eth_getLogs');
  });

  it('passes on a "too many results" error — the provider has the logs', async () => {
    const rpc = makeRpc({
      eth_getBlockByNumber: () => ({ number: '0x64' }),
      eth_getLogs: () => {
        throw { error: { code: -32005, message: 'query returned more than 10000 results' } };
      },
    });
    expect(await probeLogDepth({ rpcClient: rpc, address: '0xabc', fromBlock: 100n })).toEqual({
      ok: true,
    });
  });

  it('probes a bounded window from fromBlock with a lowercased address', async () => {
    const getLogs = vi.fn(() => []);
    const rpc = makeRpc({ eth_getBlockByNumber: () => ({ number: '0x64' }), eth_getLogs: getLogs });
    await probeLogDepth({ rpcClient: rpc, address: '0xAbC', fromBlock: 100n, window: 50 });
    expect(getLogs).toHaveBeenCalledWith([
      { fromBlock: '0x64', toBlock: '0x96', address: '0xabc' },
    ]);
  });
});
