const raw = process.env['OTEL_SERVICE_NAMESPACE'];
if (!raw) {
  throw new Error('OTEL_SERVICE_NAMESPACE must be set before importing @libs/observability');
}
export const metricPrefix = raw
  .toLowerCase()
  .replace(/-/g, '_')
  .replace(/[^a-z0-9_:]/g, '');
