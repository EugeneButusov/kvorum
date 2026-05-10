import { FetchRequest, JsonRpcProvider, Network } from 'ethers';
import type { ProviderConfig } from '../config/config.js';
import { NotImplementedError } from '../errors/not-implemented.error.js';

/**
 * Constructs a per-provider ethers JsonRpcProvider.
 * - Hoists Network.from(chainId) once and passes it as both `network` and `staticNetwork`
 *   so ethers v6 never issues an eth_chainId detection call.
 * - batchMaxCount: 1 — one HTTP request per send(), required for per-call circuit accounting.
 * - cacheTimeout: -1 — disables ethers' result cache so failover retries always hit the wire.
 * - FetchRequest carries the per-attempt timeout (default 4s).
 */
export function createJsonRpcProvider(provider: ProviderConfig, chainId: number): JsonRpcProvider {
  if (provider.kind === 'ws') {
    throw new NotImplementedError(
      `WebSocket transport is not implemented in M1 (ADR-037). Provider: ${provider.name}`,
    );
  }

  const fr = new FetchRequest(provider.url);
  fr.timeout = provider.timeoutMs ?? 4_000;

  const net = Network.from(chainId);

  return new JsonRpcProvider(fr, net, {
    staticNetwork: net,
    batchMaxCount: 1,
    cacheTimeout: -1,
  });
}
