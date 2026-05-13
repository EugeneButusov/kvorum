import { renderMetrics } from '@libs/observability';

function parsePrometheusText(text: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const spaceIdx = line.lastIndexOf(' ');
    if (spaceIdx === -1) continue;
    const key = line.slice(0, spaceIdx).trim();
    const value = parseFloat(line.slice(spaceIdx + 1));
    if (!isNaN(value)) {
      result.set(key, value);
    }
  }
  return result;
}

function buildMetricKey(name: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return labelStr ? `${name}{${labelStr}}` : name;
}

export function findMetricValue(
  metrics: Map<string, number>,
  name: string,
  labels: Record<string, string>,
): number {
  const exact = buildMetricKey(name, labels);
  if (metrics.has(exact)) return metrics.get(exact)!;

  for (const [key, value] of metrics) {
    if (!key.startsWith(name + '{') && key !== name) continue;
    const allMatch = Object.entries(labels).every(([k, v]) => key.includes(`${k}="${v}"`));
    if (allMatch) return value;
  }
  return 0;
}

export async function captureMetrics(): Promise<Map<string, number>> {
  const text = await renderMetrics();
  return parsePrometheusText(text);
}

export async function getCounterDelta(
  name: string,
  labels: Record<string, string>,
  baseline: Map<string, number>,
): Promise<number> {
  const current = await captureMetrics();
  const before = findMetricValue(baseline, name, labels);
  const after = findMetricValue(current, name, labels);
  return after - before;
}

export async function getHistogramSampleCount(
  name: string,
  labels: Record<string, string>,
  baseline: Map<string, number>,
): Promise<number> {
  return getCounterDelta(`${name}_count`, labels, baseline);
}
