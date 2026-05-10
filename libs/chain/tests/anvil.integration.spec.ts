/**
 * Integration test against a live Anvil node (chainId 31337).
 * Skipped unless ANVIL_RPC_URL is set in the environment.
 * CI provides it via the `anvil` service container (ANVIL_RPC_URL=http://anvil:8545).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FailoverRpcClient } from '../src/failover-rpc-client.js';
import type { ChainConfig } from '../src/config.js';
import { resetMetrics } from '../src/metrics.js';

const ANVIL_URL = process.env['ANVIL_RPC_URL'];

const describeIf = ANVIL_URL ? describe : describe.skip;

describeIf('Anvil integration', () => {
  let client: FailoverRpcClient;

  beforeAll(async () => {
    const config: ChainConfig = {
      chainId: 31337,
      name: 'anvil',
      reorgHorizon: 1,
      providers: [
        {
          name: 'anvil',
          url: ANVIL_URL!,
          kind: 'http',
          priority: 1,
          timeoutMs: 4_000,
        },
      ],
    };

    client = new FailoverRpcClient(config);
    await client.start();
  });

  afterAll(async () => {
    await client?.stop();
    resetMetrics();
  });

  it('eth_chainId returns 31337', async () => {
    const result = await client.send<string>('eth_chainId', []);
    expect(BigInt(result)).toBe(31337n);
  });

  it('eth_blockNumber returns a non-negative hex string', async () => {
    const result = await client.send<string>('eth_blockNumber', []);
    expect(typeof result).toBe('string');
    expect(BigInt(result)).toBeGreaterThanOrEqual(0n);
  });

  it('getHealth() shows provider as verified', () => {
    const health = client.getHealth();
    expect(health.chainId).toBe(31337);
    const [provider] = health.providers;
    expect(provider!.verified).toBe(true);
    expect(provider!.unusable).toBe(false);
    expect(provider!.circuitState).toBe('closed');
  });
});
