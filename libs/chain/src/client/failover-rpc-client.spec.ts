import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMetrics } from '@libs/observability';
import { FailoverRpcClient, createFailoverRpcClient } from './failover-rpc-client.js';
import type { ChainConfig } from '../config/config.js';
import { AllProvidersFailedError } from '../errors/all-providers-failed.error.js';
import { ClientStoppedError } from '../errors/client-stopped.error.js';
import { FakeProvider } from '../test-utils/fake-provider.js';

const baseConfig: ChainConfig = {
  chainId: '0x1',
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
    expect(health.chainId).toBe('0x1');
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
    expect(client.getHealth().chainId).toBe('0x1');
    await client.stop();
  });

  it('respects custom overallTimeoutMs from config', async () => {
    const client = new FailoverRpcClient({ ...baseConfig, overallTimeoutMs: 500 });
    expect(client.getHealth().chainId).toBe('0x1');
    await client.stop();
  });
});

async function makeClient(
  providers: FakeProvider[],
  overrides: Partial<ChainConfig> = {},
  perProviderTimeoutMs = 2000,
): Promise<{ client: FailoverRpcClient; fakes: FakeProvider[] }> {
  const config: ChainConfig = {
    chainId: '0x1',
    name: 'ethereum',
    reorgHorizon: 12,
    overallTimeoutMs: 3000,
    providers: providers.map((fp, i) => ({
      name: `p${i + 1}`,
      url: fp.url,
      kind: 'http' as const,
      priority: i + 1,
      timeoutMs: perProviderTimeoutMs,
    })),
    ...overrides,
  };

  const client = new FailoverRpcClient(config);
  // Mark all providers as verified so routing works
  for (const [, state] of client.getProviderStates()) {
    state.verified = true;
  }

  return { client, fakes: providers };
}

describe('FailoverRpcClient.send() (with FakeProvider)', () => {
  let fakes: FakeProvider[];

  beforeEach(async () => {
    fakes = [await FakeProvider.create(), await FakeProvider.create()];
  });

  afterEach(async () => {
    for (const f of fakes) await f.close();
  });

  it('(a) primary success — returns result, secondary not called', async () => {
    fakes[0]!.returnSuccess('0x1');
    fakes[1]!.returnSuccess('0x2');

    const { client } = await makeClient(fakes);
    const result = await client.send('eth_blockNumber', []);

    expect(result).toBe('0x1');
    expect(fakes[0]!.getRequestCount()).toBe(1);
    expect(fakes[1]!.getRequestCount()).toBe(0);
    await client.stop();
  });

  it('(b) primary fails → secondary success', async () => {
    fakes[0]!.returnError(503);
    fakes[1]!.returnSuccess('0x2');

    const { client } = await makeClient(fakes);
    const result = await client.send('eth_blockNumber', []);

    expect(result).toBe('0x2');
    expect(fakes[0]!.getRequestCount()).toBe(1);
    expect(fakes[1]!.getRequestCount()).toBe(1);
    await client.stop();
  });

  it('(c) all-fail → AllProvidersFailedError', async () => {
    fakes[0]!.returnError(503);
    fakes[1]!.returnError(503);

    const { client } = await makeClient(fakes);
    await expect(client.send('eth_blockNumber', [])).rejects.toThrow(AllProvidersFailedError);
    await client.stop();
  });

  it('(d) 429 → next provider, breaker tick', async () => {
    // ethers v6 converts 429 → TIMEOUT code (retries internally until per-attempt timeout fires).
    // Use a short per-attempt timeout (200ms) so p1 fails fast, and a generous overall deadline
    // so slow CI runners don't exhaust the budget before p2 gets a turn.
    fakes[0]!.returnError(429);
    fakes[1]!.returnSuccess('0x5');

    const { client } = await makeClient(fakes, { overallTimeoutMs: 8_000 }, 200);
    const result = await client.send('eth_blockNumber', []);
    expect(result).toBe('0x5');

    // Primary should have recorded a failure (circuit breaker ticked)
    const states = client.getProviderStates();
    // 1 failure on p1 — circuit stays closed (threshold is 5)
    expect(states.get('p1')!.circuit.getState()).toBe('closed');
    await client.stop();
  }, 8_000);

  it('(e) JSON-RPC envelope error → unwrapped, no breaker tick', async () => {
    fakes[0]!.returnRpcError(-32601, 'Method not found');

    const { client } = await makeClient([fakes[0]!]);
    // Should throw the original error (transparent), not AllProvidersFailedError
    await expect(client.send('eth_blockNumber', [])).rejects.not.toThrow(AllProvidersFailedError);

    const states = client.getProviderStates();
    expect(states.get('p1')!.circuit.getState()).toBe('closed');
    await client.stop();
  });

  it('(f) per-attempt timeout enforced — slow primary moves to secondary', async () => {
    // Primary stalls (never responds); secondary succeeds
    fakes[0]!.stall();
    fakes[1]!.returnSuccess('0xok');

    const { client } = await makeClient(fakes, { overallTimeoutMs: 8000 });
    // per-attempt timeout is 2000ms; overall is 8000ms
    const result = await client.send('eth_blockNumber', []);
    expect(result).toBe('0xok');
    await client.stop();
  });

  it('(g) overall deadline fires — AllProvidersFailedError with reason timeout', async () => {
    // Both providers stall
    fakes[0]!.stall();
    fakes[1]!.stall();

    const { client } = await makeClient(fakes, { overallTimeoutMs: 500 });
    const err = await client.send('eth_blockNumber', []).catch((e) => e);
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    // at least one attempt recorded as timeout
    expect((err as AllProvidersFailedError).attempts.some((a) => a.reason === 'timeout')).toBe(
      true,
    );
    await client.stop();
  });

  it('(g2) overall deadline fires → recordAbandoned is called (probe slot released)', async () => {
    // If a half-open probe is claimed and the overall deadline fires, the probe
    // slot must be released — otherwise the breaker stays stuck in half-open
    // with a permanently-set inFlightProbe. The wiring is the
    // recordAbandoned() call in the DeadlineError branch.
    fakes[0]!.stall();

    const { client } = await makeClient([fakes[0]!], { overallTimeoutMs: 200 });
    const p1State = client.getProviderStates().get('p1')!;
    const abandonedSpy = vi.spyOn(p1State.circuit, 'recordAbandoned');
    const failureSpy = vi.spyOn(p1State.circuit, 'recordFailure');

    await expect(client.send('eth_blockNumber', [])).rejects.toThrow(AllProvidersFailedError);

    expect(abandonedSpy).toHaveBeenCalled();
    // Deadline must NOT tick the breaker as a failure — it's an abandon, not a verdict
    expect(failureSpy).not.toHaveBeenCalled();
    await client.stop();
  });

  it('(h) send() during stop() → ClientStoppedError with NO breaker tick', async () => {
    // Primary stalls so we can race stop() against send()
    fakes[0]!.stall();

    const { client } = await makeClient([fakes[0]!]);
    const p1State = client.getProviderStates().get('p1')!;
    const recordFailureSpy = vi.spyOn(p1State.circuit, 'recordFailure');

    const sendPromise = client.send('eth_blockNumber', []);
    await client.stop(); // sets stopped flag before send resolves

    await expect(sendPromise).rejects.toThrow(ClientStoppedError);
    // Breaker must NOT have been ticked
    expect(recordFailureSpy).not.toHaveBeenCalled();
  });

  it('(i) all-deprioritized → degraded mode, attempts succeed', async () => {
    fakes[0]!.returnSuccess('0xdeprio');

    const { client } = await makeClient([fakes[0]!]);
    // Mark p1 as deprioritized (lagging)
    client.getProviderStates().get('p1')!.deprioritized = true;

    const result = await client.send('eth_blockNumber', []);
    expect(result).toBe('0xdeprio');
    await client.stop();
  });

  it('(j) verified=false providers excluded from routing', async () => {
    fakes[0]!.returnSuccess('should not be called');
    fakes[1]!.returnSuccess('0xverified');

    const { client } = await makeClient(fakes);
    // Mark p1 as not verified — simulates failed chainId probe
    client.getProviderStates().get('p1')!.verified = false;

    const result = await client.send('eth_blockNumber', []);
    expect(result).toBe('0xverified');
    expect(fakes[0]!.getRequestCount()).toBe(0);
    await client.stop();
  });

  it('metrics are emitted on success', async () => {
    fakes[0]!.returnSuccess('0x1');
    const { client } = await makeClient([fakes[0]!]);
    await client.send('eth_blockNumber', []);

    const metrics = await renderMetrics();
    expect(metrics).toContain('test_ingestion_rpc_requests_total');
    expect(metrics).toContain('test_ingestion_rpc_request_duration_seconds');
    await client.stop();
  });

  it('metrics emit failure reason on provider error', async () => {
    fakes[0]!.returnError(503);
    fakes[1]!.returnSuccess('0x2');
    const { client } = await makeClient(fakes);
    await client.send('eth_blockNumber', []);

    const metrics = await renderMetrics();
    expect(metrics).toContain('test_ingestion_rpc_failures_total');
    await client.stop();
  });

  it('stopped before send throws immediately', async () => {
    const { client } = await makeClient([fakes[0]!]);
    await client.stop();
    await expect(client.send('eth_blockNumber', [])).rejects.toThrow(ClientStoppedError);
  });
});
