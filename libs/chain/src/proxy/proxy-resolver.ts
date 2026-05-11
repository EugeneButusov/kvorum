import { silentLogger } from '../logger.js';
import { STANDARD_PROXY_SLOTS } from './slots.js';
import type { RpcClient } from '../client/rpc-client.js';
import type { Logger } from '../logger.js';
import type { ResolutionResult, ResolutionStep, ResolverOptions } from './types.js';
import { getProxyResolutionsTotal } from '../metrics/metrics.js';

const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const DEFAULT_MAX_DEPTH = 3;

// bytes4(keccak256("implementation()"))
const IMPL_SELECTOR = '0x5c60da1b';

function parseAddressFromSlot(raw: string): string {
  // 32-byte response — address is right-aligned in the last 20 bytes
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  return '0x' + hex.slice(-40).toLowerCase();
}

export class ProxyResolver {
  private readonly rpcClient: RpcClient;
  private readonly chainName: string;
  private readonly maxDepth: number;
  private readonly logger: Logger;

  constructor(opts: ResolverOptions) {
    this.rpcClient = opts.rpcClient;
    this.chainName = opts.chainName;
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.logger = opts.logger ?? silentLogger;
  }

  async resolve(address: string): Promise<ResolutionResult> {
    const visited = new Set<string>();
    const result = await this.resolveAt(address.toLowerCase(), 0, [], visited);
    getProxyResolutionsTotal().inc({ chain: this.chainName, result: result.reason });
    return result;
  }

  private async resolveAt(
    addr: string,
    depth: number,
    path: ResolutionStep[],
    visited: Set<string>,
  ): Promise<ResolutionResult> {
    if (visited.has(addr)) {
      this.logger.warn(`[chain:${this.chainName}] ProxyResolver: cycle detected at ${addr}`);
      return { implementation: null, path, capped: false, reason: 'cycle' };
    }

    if (depth >= this.maxDepth) {
      return { implementation: addr, path, capped: true, reason: 'capped' };
    }

    visited.add(addr);

    let allFailed = true;

    for (const { slot, kind } of STANDARD_PROXY_SLOTS) {
      let rawSlot: string;
      try {
        rawSlot = await this.rpcClient.send<string>('eth_getStorageAt', [addr, slot, 'latest']);
      } catch (err) {
        this.logger.debug(
          `[chain:${this.chainName}] ProxyResolver: eth_getStorageAt slot ${kind} failed for ${addr}: ${String(err)}`,
        );
        continue;
      }

      allFailed = false;

      const nextAddr = parseAddressFromSlot(rawSlot);
      if (nextAddr === ZERO_ADDRESS) {
        continue;
      }

      if (kind === 'eip1967-beacon') {
        let beaconImplRaw: string;
        try {
          beaconImplRaw = await this.rpcClient.send<string>('eth_call', [
            { to: nextAddr, data: IMPL_SELECTOR },
            'latest',
          ]);
        } catch (err) {
          this.logger.debug(
            `[chain:${this.chainName}] ProxyResolver: beacon eth_call failed for ${nextAddr}: ${String(err)}`,
          );
          continue;
        }

        const beaconImpl = parseAddressFromSlot(beaconImplRaw);
        if (beaconImpl === ZERO_ADDRESS) {
          continue;
        }

        const nextPath = [...path, { proxyAddress: addr, slot, kind }];
        return await this.resolveAt(beaconImpl, depth + 1, nextPath, visited);
      }

      const nextPath = [...path, { proxyAddress: addr, slot, kind }];
      return await this.resolveAt(nextAddr, depth + 1, nextPath, visited);
    }

    if (allFailed) {
      // Distinguishing 'not a proxy' from 'unreadable storage' requires at least one
      // successful probe. With all probes failing we can't make that call, so propagate
      // all_slots_failed regardless of depth — mid-chain failures must not be silently
      // reported as a resolved implementation.
      this.logger.warn(
        `[chain:${this.chainName}] ProxyResolver: all slot probes failed for ${addr} at depth ${depth} (RPC instability?)`,
      );
      return { implementation: null, path, capped: false, reason: 'all_slots_failed' };
    }

    if (depth === 0) {
      return { implementation: null, path: [], capped: false, reason: 'not_a_proxy' };
    }

    return { implementation: addr, path, capped: false, reason: 'resolved' };
  }
}
