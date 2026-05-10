import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FailoverRpcClient } from '../src/failover-rpc-client.js';
import { AllProvidersFailedError } from '../src/all-providers-failed.error.js';
import { ClientStoppedError } from '../src/client-stopped.error.js';
import { resetMetrics, getChainMetricsRegistry } from '../src/metrics.js';
import { FakeProvider } from './fake-provider.js';
import type { ChainConfig } from '../src/config.js';

afterEach(() => resetMetrics());

async function makeClient(
  providers: FakeProvider[],
  overrides: Partial<ChainConfig> = {},
  perProviderTimeoutMs = 2000,
): Promise<{ client: FailoverRpcClient; fakes: FakeProvider[] }> {
  const config: ChainConfig = {
    chainId: 1,
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

describe('FailoverRpcClient.send()', () => {
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
    // Use a short per-attempt timeout (200ms) so p1 fails fast even with ethers retry backoff,
    // leaving ample time in the 3s overall deadline for p2.
    fakes[0]!.returnError(429);
    fakes[1]!.returnSuccess('0x5');

    const { client } = await makeClient(fakes, {}, 200);
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

    const metrics = await getChainMetricsRegistry().metrics();
    expect(metrics).toContain('kvorum_ingestion_rpc_requests_total');
    expect(metrics).toContain('kvorum_ingestion_rpc_request_duration_seconds');
    await client.stop();
  });

  it('metrics emit failure reason on provider error', async () => {
    fakes[0]!.returnError(503);
    fakes[1]!.returnSuccess('0x2');
    const { client } = await makeClient(fakes);
    await client.send('eth_blockNumber', []);

    const metrics = await getChainMetricsRegistry().metrics();
    expect(metrics).toContain('kvorum_ingestion_rpc_failures_total');
    await client.stop();
  });

  it('stopped before send throws immediately', async () => {
    const { client } = await makeClient([fakes[0]!]);
    await client.stop();
    await expect(client.send('eth_blockNumber', [])).rejects.toThrow(ClientStoppedError);
  });
});
