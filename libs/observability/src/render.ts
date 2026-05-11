import { PrometheusSerializer } from '@opentelemetry/exporter-prometheus';
import { exporter } from './provider.js';

export async function renderMetrics(): Promise<string> {
  const { resourceMetrics } = await exporter.collect();
  return new PrometheusSerializer().serialize(resourceMetrics);
}
