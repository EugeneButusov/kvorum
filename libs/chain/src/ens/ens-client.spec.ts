import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { encodeMulticall3TryAggregate, encodeUniversalResolverReverse } from './ens-abi.js';
import { EnsClient, MainnetRequiredForEnsError } from './ens-client.js';

const MULTICALL_IFACE = new Interface([
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
]);
const RESOLVER_IFACE = new Interface([
  'function reverse(bytes reverseName) view returns (string name, address resolvedAddress, address reverseResolver, address resolver)',
]);
const ZERO = '0x0000000000000000000000000000000000000000';
const ADDR1 = '0x0000000000000000000000000000000000000001';
const ADDR2 = '0x0000000000000000000000000000000000000002';
const ADDR3 = '0x0000000000000000000000000000000000000003';
const ADDR4 = '0x0000000000000000000000000000000000000004';

function encodeReverseReturn(name: string, resolvedAddr: string): string {
  return RESOLVER_IFACE.encodeFunctionResult('reverse', [name, resolvedAddr, ZERO, ZERO]);
}

function encodeMulticallReturn(items: Array<{ success: boolean; returnData: string }>): string {
  return MULTICALL_IFACE.encodeFunctionResult('tryAggregate', [items]);
}

function makeMainnetClient(sendImpl: () => Promise<unknown>) {
  return {
    getHealth: vi.fn().mockReturnValue({ chainId: '0x1' }),
    send: vi.fn().mockImplementation(sendImpl),
  };
}

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

  it('resolves resolved/no_record/mismatch/failed-call outcomes from multicall batch', async () => {
    const returnData = encodeMulticallReturn([
      { success: true, returnData: encodeReverseReturn('alice.eth', ADDR1) }, // resolved
      { success: true, returnData: encodeReverseReturn('', ADDR2) }, // no_record (empty name)
      { success: true, returnData: encodeReverseReturn('bob.eth', ZERO) }, // mismatch (addr3 ≠ ZERO)
      { success: false, returnData: '0x' }, // failed call
    ]);
    const client = makeMainnetClient(() => Promise.resolve(returnData));
    const ens = new EnsClient(client as never);

    const result = await ens.batchReverseResolve([ADDR1, ADDR2, ADDR3, ADDR4]);

    expect(result.get(ADDR1)).toEqual({ kind: 'resolved', name: 'alice.eth' });
    expect(result.get(ADDR2)).toEqual({ kind: 'no_record' });
    expect(result.get(ADDR3)).toEqual({ kind: 'mismatch', reverseName: 'bob.eth' });
    expect(result.get(ADDR4)).toEqual({ kind: 'error', reason: 'reverse_call_failed' });
  });

  it('marks address as missing_multicall_item when result tuple is shorter than address list', async () => {
    const returnData = encodeMulticallReturn([
      { success: true, returnData: encodeReverseReturn('alice.eth', ADDR1) },
    ]);
    const client = makeMainnetClient(() => Promise.resolve(returnData));
    const ens = new EnsClient(client as never);

    const result = await ens.batchReverseResolve([ADDR1, ADDR2]);

    expect(result.get(ADDR1)).toEqual({ kind: 'resolved', name: 'alice.eth' });
    expect(result.get(ADDR2)).toEqual({ kind: 'error', reason: 'missing_multicall_item' });
  });

  it('marks address as decode_failed when returnData is unparseable', async () => {
    const returnData = encodeMulticallReturn([
      { success: true, returnData: '0xdeadbeef' }, // garbage — decodeUniversalResolverReverseReturn will throw
    ]);
    const client = makeMainnetClient(() => Promise.resolve(returnData));
    const ens = new EnsClient(client as never);

    const result = await ens.batchReverseResolve([ADDR1]);

    expect(result.get(ADDR1)).toMatchObject({ kind: 'error' });
  });

  it('uses rpc_call_failed reason when outer catch receives a non-Error rejection', async () => {
    const client = makeMainnetClient(() => Promise.reject('not-an-error-object'));
    const ens = new EnsClient(client as never);

    const result = await ens.batchReverseResolve([ADDR1]);

    expect(result.get(ADDR1)).toEqual({ kind: 'error', reason: 'rpc_call_failed' });
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

  it('throws on invalid address in encodeUniversalResolverReverse', () => {
    expect(() => encodeUniversalResolverReverse('not-an-address')).toThrow('invalid_address');
  });
});
