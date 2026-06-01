import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  renderMetrics as RenderMetricsType,
  shutdownForTest as ShutdownForTestType,
} from '@libs/observability';
import type {
  chainMetrics as ChainMetricsType,
  sanitizeMethod as SanitizeMethodType,
} from './metrics.js';

let chainMetrics: typeof ChainMetricsType;
let sanitizeMethod: typeof SanitizeMethodType;
let renderMetrics: typeof RenderMetricsType;
let shutdownForTest: typeof ShutdownForTestType;

beforeEach(async () => {
  vi.resetModules();
  process.env['OTEL_SERVICE_NAMESPACE'] = 'test';
  process.env['OTEL_SERVICE_NAME'] = 'chain-test';
  ({ renderMetrics, shutdownForTest } = await import('@libs/observability'));
  ({ chainMetrics, sanitizeMethod } = await import('./metrics.js'));
});

afterEach(async () => {
  await shutdownForTest();
});

describe('chainMetrics counters', () => {
  it('rpcRequests counter emits _total series', async () => {
    chainMetrics.rpcRequests.add(1, {
      provider: 'alchemy',
      chain: 'ethereum',
      method: 'eth_blockNumber',
      status: 'success',
    });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_rpc_requests_total');
  });

  it('rpcFailures counter emits _total series', async () => {
    chainMetrics.rpcFailures.add(1, { provider: 'alchemy', chain: 'ethereum', reason: 'timeout' });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_rpc_failures_total');
  });

  it('archiveWrites counter emits _total series', async () => {
    chainMetrics.archiveWrites.add(1, { chain: 'ethereum' });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_archive_writes_total');
  });

  it('proxyResolutions counter emits _total series', async () => {
    chainMetrics.proxyResolutions.add(1, { chain: 'ethereum', result: 'resolved' });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_proxy_resolutions_total');
  });

  it('gap fill counters emit _total series', async () => {
    chainMetrics.ingestionGapFillFailed.add(1, {
      chain: 'ethereum',
      dao_source: 'src-1',
      reason: 'error',
    });
    chainMetrics.ingestionGapFillSkipped.add(1, {
      chain: 'ethereum',
      dao_source: 'src-1',
      reason: 'no_active_from_block',
    });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_gap_fill_failed_total');
    expect(text).toContain('test_ingestion_gap_fill_skipped_total');
  });
});

describe('chainMetrics gauges', () => {
  it('circuitState gauge emits series with no _total suffix', async () => {
    chainMetrics.circuitState.record(0, { provider: 'alchemy', chain: 'ethereum' });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_circuit_state');
    expect(text).not.toContain('test_ingestion_circuit_state_total');
  });

  it('headBlockAge gauge emits series', async () => {
    chainMetrics.headBlockAge.record(12.5, { chain: 'ethereum' });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_head_block_age_seconds');
  });

  it('underivedDepth gauge emits series', async () => {
    chainMetrics.underivedDepth.record(42, { chain_id: '0x1', source_type: 'compound_governor' });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_underived_depth');
  });

  it('indexerActiveSources gauge emits series', async () => {
    chainMetrics.indexerActiveSources.record(1, { source_type: 'compound_governor' });
    const text = await renderMetrics();
    expect(text).toContain('test_indexer_active_sources');
  });
});

describe('chainMetrics histograms', () => {
  it('rpcRequestDuration histogram emits _bucket/_sum/_count', async () => {
    chainMetrics.rpcRequestDuration.record(0.3, {
      provider: 'alchemy',
      chain: 'ethereum',
      method: 'eth_blockNumber',
    });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_rpc_request_duration_seconds_bucket');
    expect(text).toContain('test_ingestion_rpc_request_duration_seconds_sum');
    expect(text).toContain('test_ingestion_rpc_request_duration_seconds_count');
  });

  it('batchDuration histogram emits with configured buckets', async () => {
    chainMetrics.batchDuration.record(0.5, { source: 'compound_governor' });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_batch_duration_seconds_bucket');
    expect(text).toContain('le="12"');
  });
});

describe('F1 archive metrics', () => {
  it('archiveWrites counter emits series', async () => {
    chainMetrics.archiveWrites.add(1, {
      source: 'compound_governor',
      event_type: 'ProposalCreated',
      result: 'inserted',
    });
    chainMetrics.archiveWrites.add(1, {
      source: 'compound_governor',
      event_type: 'ProposalCreated',
      result: 'skipped_existing',
    });
    chainMetrics.archiveWrites.add(1, {
      source: 'compound_governor',
      event_type: 'ProposalCreated',
      result: 'skipped_conflict',
    });
    chainMetrics.archiveWrites.add(1, {
      source: 'compound_governor',
      event_type: 'ProposalCreated',
      result: 'dlq_routed',
    });
    const text = await renderMetrics();
    expect(text).toContain('test_ingestion_archive_writes_total');
  });

  it('archiveDuplicateSkip counter emits series', async () => {
    chainMetrics.archiveDuplicateSkip.add(1, { source: 'compound_governor' });
    const text = await renderMetrics();
    expect(text).toContain('test_archive_duplicate_skip_total');
  });

  it('archiveChWriteErrors counter emits series', async () => {
    chainMetrics.archiveChWriteErrors.add(1, { source: 'compound_governor' });
    const text = await renderMetrics();
    expect(text).toContain('test_archive_ch_write_errors_total');
  });

  it('archiveDecodeErrors counter emits series with reason labels', async () => {
    chainMetrics.archiveDecodeErrors.add(1, {
      source: 'compound_governor',
      reason: 'unknown_topic',
    });
    const text = await renderMetrics();
    expect(text).toContain('test_archive_decode_errors_total');
  });

  it('archiveDecodeWarnings counter emits series with reason labels', async () => {
    chainMetrics.archiveDecodeWarnings.add(1, {
      source: 'compound_governor',
      reason: 'unexpected_support',
    });
    const text = await renderMetrics();
    expect(text).toContain('test_archive_decode_warnings_total');
  });

  it('dualWritePgUnreachable counter emits series', async () => {
    chainMetrics.dualWritePgUnreachable.add(1, { source: 'compound_governor' });
    const text = await renderMetrics();
    expect(text).toContain('test_dual_write_pg_unreachable_total');
  });

  it('guard: archiveWrites never receives unreachable result label', async () => {
    chainMetrics.archiveWrites.add(1, {
      source: 'compound_governor',
      event_type: 'ProposalCreated',
      result: 'inserted',
    });
    const text = await renderMetrics();
    expect(text).not.toContain('result="unreachable"');
    expect(text).not.toContain('result="ch_dlq_routed"');
    expect(text).not.toContain('result="decode_error"');
  });
});

describe('shutdownForTest + vi.resetModules isolation', () => {
  it('re-import after shutdown yields a fresh provider (counter resets to 0)', async () => {
    chainMetrics.rpcRequests.add(5, {
      provider: 'p',
      chain: 'c',
      method: 'eth_call',
      status: 'ok',
    });
    const t1 = await renderMetrics();
    expect(t1).toMatch(/test_ingestion_rpc_requests_total\{.*\}\s+5/);

    await shutdownForTest();
    vi.resetModules();
    process.env['OTEL_SERVICE_NAMESPACE'] = 'test';
    process.env['OTEL_SERVICE_NAME'] = 'chain-test';
    ({ renderMetrics, shutdownForTest } = await import('@libs/observability'));
    ({ chainMetrics } = await import('./metrics.js'));

    chainMetrics.rpcRequests.add(1, {
      provider: 'p',
      chain: 'c',
      method: 'eth_call',
      status: 'ok',
    });
    const t2 = await renderMetrics();
    expect(t2).toMatch(/test_ingestion_rpc_requests_total\{.*\}\s+1/);
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
