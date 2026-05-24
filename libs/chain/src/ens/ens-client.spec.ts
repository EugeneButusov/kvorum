import { describe, expect, it, vi } from 'vitest';
import { EnsClient, MainnetRequiredForEnsError } from './ens-client.js';
import { encodeMulticall3TryAggregate, encodeUniversalResolverReverse } from './ens-abi.js';

describe('EnsClient', () => {
  it('throws when chain is not mainnet', () => {
    const client = {
      getHealth: vi.fn().mockReturnValue({ chainId: '0x89' }),
    };

    expect(() => new EnsClient(client as never)).toThrow(MainnetRequiredForEnsError);
  });

  it('marks chunk as error on rpc failure', async () => {
    const client = {
      getHealth: vi.fn().mockReturnValue({ chainId: '0x1' }),
      send: vi.fn().mockRejectedValue(new Error('boom')),
    };

    const ens = new EnsClient(client as never);
    const result = await ens.batchReverseResolve(['0x0000000000000000000000000000000000000001']);

    expect(result.get('0x0000000000000000000000000000000000000001')).toEqual({
      kind: 'error',
      reason: 'boom',
    });
  });
});

describe('ens-abi helpers', () => {
  it('encodes multicall3 tryAggregate payload', () => {
    const data = encodeMulticall3TryAggregate([
      {
        target: '0x0000000000000000000000000000000000000001',
        callData: '0x1234',
      },
    ]);

    expect(data.startsWith('0x')).toBe(true);
  });

  it('encodes reverse lookup calldata', () => {
    const data = encodeUniversalResolverReverse('0x0000000000000000000000000000000000000001');
    expect(data.startsWith('0x')).toBe(true);
  });
});
