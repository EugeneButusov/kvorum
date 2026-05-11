import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE } from '@opentelemetry/semantic-conventions';

export const exporter = new PrometheusExporter({ preventServerStart: true });

export const provider = new MeterProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'unspecified',
    [ATTR_SERVICE_NAMESPACE]: process.env['OTEL_SERVICE_NAMESPACE']!,
  }),
  readers: [exporter],
});

export const meter = provider.getMeter(process.env['OTEL_SERVICE_NAMESPACE']!);
