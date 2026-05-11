import type { Counter, Gauge, Histogram } from '@opentelemetry/api';
import { metricPrefix } from './prefix';
import { meter } from './provider';

interface CounterOpts {
  name: string;
  description: string;
}
interface GaugeOpts {
  name: string;
  description: string;
}
interface HistogramOpts {
  name: string;
  description: string;
  buckets: readonly number[];
}

export function defineCounter(opts: CounterOpts): Counter {
  if (opts.name.endsWith('_total')) {
    throw new Error(
      `Counter "${opts.name}" must not end in _total — the Prometheus exporter appends it`,
    );
  }
  return meter.createCounter(`${metricPrefix}_${opts.name}`, { description: opts.description });
}

export function defineGauge(opts: GaugeOpts): Gauge {
  return meter.createGauge(`${metricPrefix}_${opts.name}`, { description: opts.description });
}

export function defineHistogram(opts: HistogramOpts): Histogram {
  return meter.createHistogram(`${metricPrefix}_${opts.name}`, {
    description: opts.description,
    advice: { explicitBucketBoundaries: [...opts.buckets] },
  });
}
