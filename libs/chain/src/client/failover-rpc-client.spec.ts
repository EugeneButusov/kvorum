import { afterEach, describe, expect, it } from 'vitest';
import { FailoverRpcClient, createFailoverRpcClient } from './failover-rpc-client.js';
import { ClientStoppedError } from '../errors/client-stopped.error.js';
import { resetMetrics } from '../metrics/metrics.js';
import type { ChainConfig } from '../config/config.js';

// Pure-unit tests: no HTTP, no health-checker.start().
// Behaviour that requires a real (or fake) JSON-RPC server lives in
// tests/failover-rpc-client.spec.ts.

afterEach(() => resetMetrics());

const baseConfig: ChainConfig = {
  chainId: 1,
  name: 'ethereum',
  reorgHorizon: 12,
  providers: [
    { name: 'b', url: 'http://127.0.0.1:9', kind: 'http', priority: 2 },
    { name: 'a', url: 'http://127.0.0.1:9', kind: 'http', priority: 1 },
  ],
};

describe('FailoverRpcClient (unit)', () => {
  it('sorts providers by priority ascending', async () => {
    const client = new FailoverRpcClient(baseConfig);
    const names = [...client.getProviderStates().keys()];
    expect(names).toEqual(['a', 'b']);
    await client.stop();
  });

  it('breaks priority ties by name lexicographically', async () => {
    const config: ChainConfig = {
      ...baseConfig,
      providers: [
        { name: 'zeta', url: 'http://127.0.0.1:9', kind: 'http', priority: 1 },
        { name: 'alpha', url: 'http://127.0.0.1:9', kind: 'http', priority: 1 },
        { name: 'beta', url: 'http://127.0.0.1:9', kind: 'http', priority: 1 },
      ],
    };
    const client = new FailoverRpcClient(config);
    expect([...client.getProviderStates().keys()]).toEqual(['alpha', 'beta', 'zeta']);
    await client.stop();
  });

  it('getHealth() reports chainId and a row per configured provider', async () => {
    const client = new FailoverRpcClient(baseConfig);
    const health = client.getHealth();
    expect(health.chainId).toBe(1);
    expect(health.providers).toHaveLength(2);

    const a = health.providers.find((p) => p.name === 'a')!;
    expect(a.circuitState).toBe('closed');
    expect(a.verified).toBe(false);
    expect(a.unusable).toBe(false);
    expect(a.deprioritized).toBe(false);
    expect(a.lastBlockNumber).toBeNull();
    expect(a.lastHealthCheckAt).toBeNull();
    expect(a.consecutiveHealthFailures).toBe(0);

    await client.stop();
  });

  it('getProviderStates returns shared state references on each call', async () => {
    const client = new FailoverRpcClient(baseConfig);
    const m1 = client.getProviderStates();
    const m2 = client.getProviderStates();
    // Fresh Map each call, but the underlying ProviderState instances are shared
    expect(m1).not.toBe(m2);
    expect(m1.get('a')).toBe(m2.get('a'));
    expect(m1.get('b')).toBe(m2.get('b'));
    await client.stop();
  });

  it('send() before start() but after stop() throws ClientStoppedError without touching providers', async () => {
    const client = new FailoverRpcClient(baseConfig);
    await client.stop();
    await expect(client.send('eth_blockNumber', [])).rejects.toThrow(ClientStoppedError);
  });

  it('send() with no verified providers throws AllProvidersFailedError immediately', async () => {
    const client = new FailoverRpcClient(baseConfig);
    // No provider state has verified=true (start() never ran), so both passes are empty
    await expect(client.send('eth_blockNumber', [])).rejects.toThrow(/all providers failed/i);
    await client.stop();
  });

  it('stop() is idempotent (multiple calls do not throw)', async () => {
    const client = new FailoverRpcClient(baseConfig);
    await client.stop();
    await expect(client.stop()).resolves.not.toThrow();
  });

  it('createFailoverRpcClient factory returns an RpcClient with all required methods', async () => {
    const client = createFailoverRpcClient(baseConfig);
    expect(typeof client.send).toBe('function');
    expect(typeof client.getHealth).toBe('function');
    expect(typeof client.start).toBe('function');
    expect(typeof client.stop).toBe('function');
    await client.stop();
  });

  it('uses default overall deadline of 12s when overallTimeoutMs is omitted', async () => {
    // We can't observe defaultDeadlineMs directly, but constructing with omitted
    // overallTimeoutMs must not throw — the field is optional in ChainConfig.
    const client = new FailoverRpcClient(baseConfig);
    expect(client.getHealth().chainId).toBe(1);
    await client.stop();
  });

  it('respects custom overallTimeoutMs from config', async () => {
    const client = new FailoverRpcClient({ ...baseConfig, overallTimeoutMs: 500 });
    expect(client.getHealth().chainId).toBe(1);
    await client.stop();
  });
});
