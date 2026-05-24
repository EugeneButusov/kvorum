import type { FailoverRpcClient } from '../client/failover-rpc-client.js';
import {
  decodeMulticall3TryAggregateReturn,
  decodeUniversalResolverReverseReturn,
  encodeMulticall3TryAggregate,
  encodeUniversalResolverReverse,
  ENS_UNIVERSAL_RESOLVER_ADDRESS,
  MULTICALL3_ADDRESS,
} from './ens-abi.js';

const MAINNET_CHAIN_ID = '0x1';
const BATCH_SIZE = 50;

export type ReverseResolveOutcome =
  | { kind: 'resolved'; name: string }
  | { kind: 'no_record' }
  | { kind: 'mismatch'; reverseName: string }
  | { kind: 'error'; reason: string };

export class MainnetRequiredForEnsError extends Error {
  constructor(chainId: string) {
    super(
      `ENS Universal Resolver is mainnet-only; got chainId=${chainId}. Add mainnet to CHAIN_CONFIG and retry.`,
    );
    this.name = 'MainnetRequiredForEnsError';
  }
}

export class EnsClient {
  constructor(private readonly client: FailoverRpcClient) {
    const chainId = this.client.getHealth().chainId;
    if (chainId.toLowerCase() !== MAINNET_CHAIN_ID) {
      throw new MainnetRequiredForEnsError(chainId);
    }
  }

  async batchReverseResolve(
    addresses: readonly string[],
  ): Promise<Map<string, ReverseResolveOutcome>> {
    const results = new Map<string, ReverseResolveOutcome>();

    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const chunk = addresses.slice(i, i + BATCH_SIZE);
      await this.resolveChunk(chunk, results);
    }

    return results;
  }

  private async resolveChunk(
    addresses: readonly string[],
    results: Map<string, ReverseResolveOutcome>,
  ): Promise<void> {
    const calls = addresses.map((address) => ({
      target: ENS_UNIVERSAL_RESOLVER_ADDRESS,
      callData: encodeUniversalResolverReverse(address),
    }));

    const payload = encodeMulticall3TryAggregate(calls);

    try {
      const returnData = await this.client.send<string>('eth_call', [
        { to: MULTICALL3_ADDRESS, data: payload },
        'latest',
      ]);
      const decoded = decodeMulticall3TryAggregateReturn(returnData);

      for (let idx = 0; idx < addresses.length; idx += 1) {
        const address = addresses[idx]!;
        const item = decoded[idx];

        if (item == null) {
          results.set(address, { kind: 'error', reason: 'missing_multicall_item' });
          continue;
        }

        if (!item.success) {
          results.set(address, { kind: 'error', reason: 'reverse_call_failed' });
          continue;
        }

        try {
          const reverse = decodeUniversalResolverReverseReturn(item.returnData);
          if (reverse.name.trim().length === 0) {
            results.set(address, { kind: 'no_record' });
            continue;
          }

          if (reverse.resolvedAddress.toLowerCase() !== address.toLowerCase()) {
            results.set(address, { kind: 'mismatch', reverseName: reverse.name });
            continue;
          }

          results.set(address, { kind: 'resolved', name: reverse.name });
        } catch (error) {
          results.set(address, {
            kind: 'error',
            reason: error instanceof Error ? error.message : 'decode_failed',
          });
        }
      }
    } catch (error) {
      for (const address of addresses) {
        results.set(address, {
          kind: 'error',
          reason: error instanceof Error ? error.message : 'rpc_call_failed',
        });
      }
    }
  }
}
