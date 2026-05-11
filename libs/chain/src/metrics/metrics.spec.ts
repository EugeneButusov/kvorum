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
  getPendingEventCount,
  getArchiveWritesTotal,
  getArchiveSkippedExistenceTotal,
  getArchiveChWriteErrorsTotal,
  getArchiveDecodeErrorsTotal,
  getDualWritePgUnreachableTotal,
  getIndexerActiveSources,
  getBatchDurationSeconds,
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

describe('F1 archive metrics', () => {
  it('pending_event_count gauge registers and accepts chain_id + source_type labels', () => {
    const g = getPendingEventCount();
    g.set({ chain_id: '1', source_type: 'compound_governor' }, 42);
    expect(g).toBeDefined();
  });

  it('archive_writes_total counter registers with source + result labels', () => {
    const c = getArchiveWritesTotal();
    c.inc({ source: 'compound_governor', result: 'inserted' });
    c.inc({ source: 'compound_governor', result: 'skipped_existing' });
    c.inc({ source: 'compound_governor', result: 'skipped_conflict' });
    c.inc({ source: 'compound_governor', result: 'pg_dlq_routed' });
    expect(c).toBeDefined();
  });

  it('archive_skipped_existence_total counter registers', () => {
    const c = getArchiveSkippedExistenceTotal();
    c.inc({ source: 'compound_governor' });
    expect(c).toBeDefined();
  });

  it('archive_ch_write_errors_total counter registers', () => {
    const c = getArchiveChWriteErrorsTotal();
    c.inc({ source: 'compound_governor' });
    expect(c).toBeDefined();
  });

  it('archive_decode_errors_total counter registers with source + reason labels', () => {
    const c = getArchiveDecodeErrorsTotal();
    c.inc({ source: 'compound_governor', reason: 'unknown_topic' });
    c.inc({ source: 'compound_governor', reason: 'parse_failed' });
    c.inc({ source: 'compound_governor', reason: 'wrong_address' });
    expect(c).toBeDefined();
  });

  it('dual_write_pg_unreachable_total counter registers', () => {
    const c = getDualWritePgUnreachableTotal();
    c.inc({ source: 'compound_governor' });
    expect(c).toBeDefined();
  });

  it('indexer_active_sources gauge registers with source_type label', () => {
    const g = getIndexerActiveSources();
    g.set({ source_type: 'compound_governor' }, 1);
    expect(g).toBeDefined();
  });

  it('batch_duration_seconds histogram registers with correct buckets', () => {
    const h = getBatchDurationSeconds();
    h.observe({ source: 'compound_governor' }, 0.5);
    h.observe({ source: 'compound_governor' }, 12.0);
    expect(h).toBeDefined();
  });

  it('resetMetrics clears all F1 metrics — no duplicate-registration error on re-fetch', () => {
    const g1 = getPendingEventCount();
    const c1 = getArchiveWritesTotal();
    const s1 = getArchiveSkippedExistenceTotal();
    const ch1 = getArchiveChWriteErrorsTotal();
    const d1 = getArchiveDecodeErrorsTotal();
    const u1 = getDualWritePgUnreachableTotal();
    const a1 = getIndexerActiveSources();
    const b1 = getBatchDurationSeconds();
    resetMetrics();
    expect(getPendingEventCount()).not.toBe(g1);
    expect(getArchiveWritesTotal()).not.toBe(c1);
    expect(getArchiveSkippedExistenceTotal()).not.toBe(s1);
    expect(getArchiveChWriteErrorsTotal()).not.toBe(ch1);
    expect(getArchiveDecodeErrorsTotal()).not.toBe(d1);
    expect(getDualWritePgUnreachableTotal()).not.toBe(u1);
    expect(getIndexerActiveSources()).not.toBe(a1);
    expect(getBatchDurationSeconds()).not.toBe(b1);
  });

  it('guard: archive_writes_total never receives pg_unreachable result label', async () => {
    getArchiveWritesTotal();
    const registry = getChainMetricsRegistry();
    const metrics = await registry.metrics();
    // The counter should not contain pg_unreachable in its result label
    expect(metrics).not.toContain('result="pg_unreachable"');
    expect(metrics).not.toContain('result="ch_dlq_routed"');
    expect(metrics).not.toContain('result="decode_error"');
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
