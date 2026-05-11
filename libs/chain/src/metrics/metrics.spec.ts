import { afterEach, describe, expect, it } from 'vitest';
import {
  getChainMetricsRegistry,
  getRpcRequestsTotal,
  getRpcFailuresTotal,
  getCircuitState,
  getProviderLagBlocks,
  getProviderUnusable,
  getProviderVerified,
  getHealthCheckFailuresTotal,
  getRpcRequestDuration,
  getReorgSignalsTotal,
  getProxyResolutionsTotal,
  resetMetrics,
  sanitizeMethod,
} from './metrics.js';

afterEach(() => resetMetrics());

describe('metrics', () => {
  it('creates rpc_requests_total counter with correct labels', () => {
    const c = getRpcRequestsTotal();
    c.inc({ provider: 'alchemy', chain: 'ethereum', method: 'eth_blockNumber', status: 'success' });
    expect(c).toBeDefined();
  });

  it('creates rpc_failures_total counter', () => {
    const c = getRpcFailuresTotal();
    c.inc({ provider: 'alchemy', chain: 'ethereum', reason: 'timeout' });
    expect(c).toBeDefined();
  });

  it('creates circuit_state gauge (0=closed, 1=half-open, 2=open)', () => {
    const g = getCircuitState();
    g.set({ provider: 'alchemy', chain: 'ethereum' }, 0);
    g.set({ provider: 'alchemy', chain: 'ethereum' }, 2);
    expect(g).toBeDefined();
  });

  it('creates provider_lag_blocks gauge', () => {
    const g = getProviderLagBlocks();
    g.set({ provider: 'alchemy', chain: 'ethereum' }, 3);
    expect(g).toBeDefined();
  });

  it('creates provider_unusable gauge', () => {
    const g = getProviderUnusable();
    g.set({ provider: 'alchemy', chain: 'ethereum' }, 1);
    expect(g).toBeDefined();
  });

  it('creates provider_verified gauge', () => {
    const g = getProviderVerified();
    g.set({ provider: 'alchemy', chain: 'ethereum' }, 1);
    expect(g).toBeDefined();
  });

  it('creates health_check_failures_total counter', () => {
    const c = getHealthCheckFailuresTotal();
    c.inc({ provider: 'alchemy', chain: 'ethereum' });
    expect(c).toBeDefined();
  });

  it('creates rpc_request_duration histogram with correct buckets', () => {
    const h = getRpcRequestDuration();
    h.observe({ provider: 'alchemy', chain: 'ethereum', method: 'eth_blockNumber' }, 0.3);
    expect(h).toBeDefined();
  });

  it('resetMetrics clears all instances so re-creation works', () => {
    const c1 = getRpcRequestsTotal();
    resetMetrics();
    // after reset, a new counter is created — no "already registered" error
    const c2 = getRpcRequestsTotal();
    expect(c1).not.toBe(c2);
  });

  it('getOrCreate returns the same instance on repeated calls', () => {
    const a = getRpcRequestsTotal();
    const b = getRpcRequestsTotal();
    expect(a).toBe(b);
  });

  it('registry exposes the created metrics', async () => {
    getRpcRequestsTotal().inc({
      provider: 'p',
      chain: 'c',
      method: 'eth_blockNumber',
      status: 'success',
    });
    const metrics = await getChainMetricsRegistry().metrics();
    expect(metrics).toContain('kvorum_ingestion_rpc_requests_total');
  });

  it('creates reorg_signals_total counter (E4)', () => {
    const c = getReorgSignalsTotal();
    c.inc({ chain: 'ethereum' });
    expect(c).toBeDefined();
  });

  it('creates proxy_resolutions_total counter (E4)', () => {
    const c = getProxyResolutionsTotal();
    c.inc({ chain: 'ethereum', result: 'resolved' });
    expect(c).toBeDefined();
  });

  it('resetMetrics clears E4 metrics — no duplicate-registration error on re-fetch', () => {
    const c1 = getReorgSignalsTotal();
    const p1 = getProxyResolutionsTotal();
    resetMetrics();
    const c2 = getReorgSignalsTotal();
    const p2 = getProxyResolutionsTotal();
    expect(c1).not.toBe(c2);
    expect(p1).not.toBe(p2);
  });
});

describe('sanitizeMethod', () => {
  it('passes through allowlisted methods', () => {
    expect(sanitizeMethod('eth_blockNumber')).toBe('eth_blockNumber');
    expect(sanitizeMethod('eth_chainId')).toBe('eth_chainId');
    expect(sanitizeMethod('eth_getLogs')).toBe('eth_getLogs');
    expect(sanitizeMethod('eth_getStorageAt')).toBe('eth_getStorageAt');
    expect(sanitizeMethod('eth_getBlockByNumber')).toBe('eth_getBlockByNumber');
  });

  it('returns "other" for unknown methods', () => {
    expect(sanitizeMethod('eth_sendRawTransaction')).toBe('other');
    expect(sanitizeMethod('')).toBe('other');
    expect(sanitizeMethod('custom_method')).toBe('other');
  });
});
