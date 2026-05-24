import { Interface, getAddress, isAddress } from 'ethers';

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const ENS_UNIVERSAL_RESOLVER_ADDRESS = '0xce01f8eee7E479C928F8919abD53E553a36CeF67';

const multicall3Interface = new Interface([
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
]);

const universalResolverInterface = new Interface([
  'function reverse(bytes reverseName) view returns (string name, address resolvedAddress, address reverseResolver, address resolver)',
]);

export interface Multicall3Call {
  target: string;
  callData: string;
}

export interface Multicall3ReturnItem {
  success: boolean;
  returnData: string;
}

export function encodeMulticall3TryAggregate(calls: readonly Multicall3Call[]): string {
  return multicall3Interface.encodeFunctionData('tryAggregate', [false, [...calls]]);
}

export function decodeMulticall3TryAggregateReturn(returnData: string): Multicall3ReturnItem[] {
  const decoded = multicall3Interface.decodeFunctionResult('tryAggregate', returnData);
  const tuples = decoded[0] as Array<{ success: boolean; returnData: string }>;
  return tuples.map((item) => ({ success: item.success, returnData: item.returnData }));
}

export function encodeUniversalResolverReverse(address: string): string {
  const normalized = normalizeAddress(address);
  const label = normalized.slice(2).toLowerCase();
  const reverseName = dnsEncode([label, 'addr', 'reverse']);
  return universalResolverInterface.encodeFunctionData('reverse', [reverseName]);
}

export function decodeUniversalResolverReverseReturn(returnData: string): {
  name: string;
  resolvedAddress: string;
} {
  const decoded = universalResolverInterface.decodeFunctionResult('reverse', returnData);
  return {
    name: decoded[0] as string,
    resolvedAddress: (decoded[1] as string).toLowerCase(),
  };
}

function dnsEncode(labels: readonly string[]): string {
  const bytes: number[] = [];

  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      throw new Error(`invalid_dns_label_length:${label.length}`);
    }
    bytes.push(label.length);
    for (let i = 0; i < label.length; i += 1) {
      bytes.push(label.charCodeAt(i));
    }
  }

  bytes.push(0);
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

function normalizeAddress(address: string): string {
  if (!isAddress(address)) throw new Error(`invalid_address:${address}`);
  return getAddress(address).toLowerCase();
}
