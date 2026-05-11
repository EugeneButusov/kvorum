import { JsonRpcProvider, Network, FetchRequest } from 'ethers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HealthChecker } from './health-checker.js';
import { createProviderState } from '../client/provider-state.js';
import type { ChainConfig } from '../config/config.js';
import { ChainConfigError } from '../errors/chain-config.error.js';
import { resetMetrics, getChainMetricsRegistry } from '../metrics/metrics.js';
import { FakeProvider } from '../test-utils/fake-provider.js';

afterEach(() => resetMetrics());

function makeEthersProvider(url: string, timeoutMs = 1500): JsonRpcProvider {
  const fr = new FetchRequest(url);
  fr.timeout = timeoutMs;
  const net = Network.from(1);
  return new JsonRpcProvider(fr, net, { staticNetwork: net, batchMaxCount: 1, cacheTimeout: -1 });
}

const BASE_CONFIG: ChainConfig = {
  chainId: 1,
  name: 'ethereum',
  reorgHorizon: 12,
  lagThresholdBlocks: 3,
  providers: [],
};

describe('HealthChecker', () => {
  let fakes: FakeProvider[];

  beforeEach(async () => {
    fakes = [await FakeProvider.create(), await FakeProvider.create(), await FakeProvider.create()];
  });

  afterEach(async () => {
    for (const f of fakes) await f.close();
  });

  it('verifies matching chainId → state.verified = true', async () => {
    // Queue: chainId response, then block number for the follow-up poll
    fakes[0]!.enqueueChainId('0x1').returnSuccess('0x10');

    const state = createProviderState('p1');
    const states = new Map([['p1', state]]);
    const providers = new Map([['p1', makeEthersProvider(fakes[0]!.url)]]);

    const hc = new HealthChecker(BASE_CONFIG, states, providers, { intervalMs: 60_000 });
    await hc.start();
    hc.stop();

    expect(state.verified).toBe(true);
    expect(state.unusable).toBe(false);
    providers.forEach((p) => p.destroy());
  });

  it('chainId mismatch → state.unusable = true, start() throws', async () => {
    fakes[0]!.returnChainId('0x89'); // chainId 137 ≠ 1

    const state = createProviderState('p1');
    const states = new Map([['p1', state]]);
    const providers = new Map([['p1', makeEthersProvider(fakes[0]!.url)]]);

    const hc = new HealthChecker(BASE_CONFIG, states, providers, { intervalMs: 60_000 });
    await expect(hc.start()).rejects.toThrow(ChainConfigError);

    expect(state.verified).toBe(false);
    expect(state.unusable).toBe(true);
    providers.forEach((p) => p.destroy());
  });

  it('chainId probe timeout (all retries fail) → state.unusable = true, start() throws', async () => {
    fakes[0]!.stall();

    const state = createProviderState('p1');
    const states = new Map([['p1', state]]);
    const providers = new Map([['p1', makeEthersProvider(fakes[0]!.url, 80)]]);

    const hc = new HealthChecker(BASE_CONFIG, states, providers, { intervalMs: 60_000 });
    await expect(hc.start()).rejects.toThrow(ChainConfigError);

    expect(state.verified).toBe(false);
    expect(state.unusable).toBe(true);
    providers.forEach((p) => p.destroy());
  }, 15_000);

  it('mixed (1 mismatch + 1 timeout) → all unusable, start() throws', async () => {
    fakes[0]!.returnChainId('0x89'); // mismatch (137 ≠ 1)
    fakes[1]!.stall(); // timeout

    const s1 = createProviderState('p1');
    const s2 = createProviderState('p2');
    const states = new Map([
      ['p1', s1],
      ['p2', s2],
    ]);

    const providers = new Map([
      ['p1', makeEthersProvider(fakes[0]!.url)],
      ['p2', makeEthersProvider(fakes[1]!.url, 80)],
    ]);

    const hc = new HealthChecker(BASE_CONFIG, states, providers, { intervalMs: 60_000 });
    await expect(hc.start()).rejects.toThrow(ChainConfigError);

    expect(s1.unusable).toBe(true);
    expect(s2.unusable).toBe(true);
    providers.forEach((p) => p.destroy());
  }, 15_000);

  it('lag-based deprioritization: provider > lagThreshold blocks behind leader', async () => {
    // p1 at block 100, p2 at block 96 (lag=4 > threshold=3 → deprioritized)
    fakes[0]!.enqueueChainId('0x1').returnSuccess('0x64'); // block 100
    fakes[1]!.enqueueChainId('0x1').returnSuccess('0x60'); // block 96

    const s1 = createProviderState('p1');
    const s2 = createProviderState('p2');
    const states = new Map([
      ['p1', s1],
      ['p2', s2],
    ]);
    const providers = new Map([
      ['p1', makeEthersProvider(fakes[0]!.url)],
      ['p2', makeEthersProvider(fakes[1]!.url)],
    ]);

    const hc = new HealthChecker(BASE_CONFIG, states, providers, { intervalMs: 60_000 });
    await hc.start();
    hc.stop();

    expect(s1.deprioritized).toBe(false);
    expect(s2.deprioritized).toBe(true);
    providers.forEach((p) => p.destroy());
  });

  it('within lag threshold → not deprioritized', async () => {
    // p1 at block 100, p2 at block 98 (lag=2 ≤ threshold=3 → not deprioritized)
    fakes[0]!.enqueueChainId('0x1').returnSuccess('0x64'); // block 100
    fakes[1]!.enqueueChainId('0x1').returnSuccess('0x62'); // block 98

    const s1 = createProviderState('p1');
    const s2 = createProviderState('p2');
    const states = new Map([
      ['p1', s1],
      ['p2', s2],
    ]);
    const providers = new Map([
      ['p1', makeEthersProvider(fakes[0]!.url)],
      ['p2', makeEthersProvider(fakes[1]!.url)],
    ]);

    const hc = new HealthChecker(BASE_CONFIG, states, providers, { intervalMs: 60_000 });
    await hc.start();
    hc.stop();

    expect(s1.deprioritized).toBe(false);
    expect(s2.deprioritized).toBe(false);
    providers.forEach((p) => p.destroy());
  });

  it('metrics: provider_verified and provider_unusable gauges are set', async () => {
    fakes[0]!.enqueueChainId('0x1').returnSuccess('0x10');

    const state = createProviderState('p1');
    const states = new Map([['p1', state]]);
    const providers = new Map([['p1', makeEthersProvider(fakes[0]!.url)]]);

    const hc = new HealthChecker(BASE_CONFIG, states, providers, { intervalMs: 60_000 });
    await hc.start();
    hc.stop();

    const metrics = await getChainMetricsRegistry().metrics();
    expect(metrics).toContain('kvorum_ingestion_provider_verified');
    expect(metrics).toContain('kvorum_ingestion_provider_unusable');
    providers.forEach((p) => p.destroy());
  });

  it('stop() clears the health check interval', async () => {
    fakes[0]!.enqueueChainId('0x1').returnSuccess('0x10');

    const state = createProviderState('p1');
    const states = new Map([['p1', state]]);
    const providers = new Map([['p1', makeEthersProvider(fakes[0]!.url)]]);

    const hc = new HealthChecker(BASE_CONFIG, states, providers, { intervalMs: 100 });
    await hc.start();

    const countBefore = fakes[0]!.getRequestCount();
    hc.stop();

    await new Promise((r) => setTimeout(r, 250));
    expect(fakes[0]!.getRequestCount()).toBe(countBefore);
    providers.forEach((p) => p.destroy());
  });
});
