import { describe, expect, it, vi } from 'vitest';
import type { RpcClient } from './client/rpc-client.js';
import { readConfirmedHead } from './confirmed-head.js';

function rpcReturning(headHex: string): RpcClient {
  return {
    send: vi.fn(async () => headHex),
  } as unknown as RpcClient;
}

describe('readConfirmedHead', () => {
  it('returns tip minus headLag when tip exceeds lag', async () => {
    const rpc = rpcReturning('0x64'); // 100
    const confirmed = await readConfirmedHead(rpc, {
      chainId: '0x1',
      name: 'ethereum',
      headLag: 12,
      providers: [{ name: 'x', url: 'http://localhost:8545', kind: 'http', priority: 1 }],
    });

    expect(confirmed).toBe(88n);
  });

  it('returns 0n when tip is less than or equal to lag', async () => {
    const rpc = rpcReturning('0xa'); // 10
    const confirmed = await readConfirmedHead(rpc, {
      chainId: '0x1',
      name: 'ethereum',
      headLag: 12,
      providers: [{ name: 'x', url: 'http://localhost:8545', kind: 'http', priority: 1 }],
    });

    expect(confirmed).toBe(0n);
  });
});
