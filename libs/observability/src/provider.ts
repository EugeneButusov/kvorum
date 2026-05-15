import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE } from '@opentelemetry/semantic-conventions';

const namespace = process.env['OTEL_SERVICE_NAMESPACE'];
if (!namespace) {
  throw new Error('OTEL_SERVICE_NAMESPACE must be set before importing @libs/observability');
}
const serviceName = process.env['OTEL_SERVICE_NAME'];
if (!serviceName) {
  throw new Error('OTEL_SERVICE_NAME must be set before importing @libs/observability');
}

export const exporter = new PrometheusExporter({ preventServerStart: true });

export const provider = new MeterProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_NAMESPACE]: namespace,
  }),
  readers: [exporter],
});

export const meter = provider.getMeter(serviceName);
