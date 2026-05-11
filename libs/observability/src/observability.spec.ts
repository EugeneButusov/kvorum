import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  defineCounter as DefineCounterType,
  defineGauge as DefineGaugeType,
  defineHistogram as DefineHistogramType,
  renderMetrics as RenderMetricsType,
  shutdownForTest as ShutdownForTestType,
} from './index';

let defineCounter: typeof DefineCounterType;
let defineGauge: typeof DefineGaugeType;
let defineHistogram: typeof DefineHistogramType;
let renderMetrics: typeof RenderMetricsType;
let shutdownForTest: typeof ShutdownForTestType;

beforeEach(async () => {
  vi.resetModules();
  process.env['OTEL_SERVICE_NAMESPACE'] = 'test';
  process.env['OTEL_SERVICE_NAME'] = 'obs-test';
  ({ defineCounter, defineGauge, defineHistogram, renderMetrics, shutdownForTest } = await import(
    './index'
  ));
});

afterEach(async () => {
  await shutdownForTest();
});

describe('defineCounter', () => {
  it('emits <prefix>_<name>_total in Prometheus text', async () => {
    const c = defineCounter({ name: 'rpc_requests', description: 'test' });
    c.add(3, { method: 'eth_call' });
    const text = await renderMetrics();
    expect(text).toContain('test_rpc_requests_total');
    expect(text).toMatch(/test_rpc_requests_total\{.*method="eth_call".*\}\s+3/);
  });

  it('throws when name ends in _total', () => {
    expect(() => defineCounter({ name: 'my_counter_total', description: 'bad' })).toThrow('_total');
  });
});

describe('defineGauge', () => {
  it('emits <prefix>_<name> with no auto-suffix', async () => {
    const g = defineGauge({ name: 'head_block_age_seconds', description: 'test' });
    g.record(42.5, { chain: 'ethereum' });
    const text = await renderMetrics();
    expect(text).toContain('test_head_block_age_seconds');
    expect(text).not.toContain('test_head_block_age_seconds_total');
    expect(text).toMatch(/test_head_block_age_seconds\{.*chain="ethereum".*\}\s+42\.5/);
  });
});

describe('defineHistogram', () => {
  it('emits _bucket/_sum/_count with configured boundaries', async () => {
    const h = defineHistogram({
      name: 'rpc_duration_seconds',
      description: 'test',
      buckets: [0.1, 0.5, 1],
    });
    h.record(0.3, { provider: 'p1' });
    const text = await renderMetrics();
    expect(text).toContain('test_rpc_duration_seconds_bucket');
    expect(text).toContain('test_rpc_duration_seconds_sum');
    expect(text).toContain('test_rpc_duration_seconds_count');
    expect(text).toContain('le="0.1"');
    expect(text).toContain('le="0.5"');
    expect(text).toContain('le="1"');
  });
});

describe('module load guard', () => {
  it('throws when OTEL_SERVICE_NAMESPACE is unset', async () => {
    vi.resetModules();
    delete process.env['OTEL_SERVICE_NAMESPACE'];
    await expect(import('./index')).rejects.toThrow('OTEL_SERVICE_NAMESPACE');
    process.env['OTEL_SERVICE_NAMESPACE'] = 'test';
  });
});

describe('shutdownForTest', () => {
  it('allows re-import after shutdown + resetModules yields a fresh provider', async () => {
    const c1 = defineCounter({ name: 'reset_test', description: 'test' });
    c1.add(5, {});
    const text1 = await renderMetrics();
    expect(text1).toContain('test_reset_test_total');

    await shutdownForTest();
    vi.resetModules();
    process.env['OTEL_SERVICE_NAMESPACE'] = 'test2';
    const {
      defineCounter: dc2,
      renderMetrics: rm2,
      shutdownForTest: sft2,
    } = await import('./index');
    const c2 = dc2({ name: 'reset_test', description: 'test' });
    c2.add(1, {});
    const text2 = await rm2();
    expect(text2).toContain('test2_reset_test_total');
    expect(text2).toMatch(/test2_reset_test_total\{.*\}\s+1/);
    await sft2();
    process.env['OTEL_SERVICE_NAMESPACE'] = 'test';
  });
});
