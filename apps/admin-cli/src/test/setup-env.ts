if (process.env['OTEL_SERVICE_NAMESPACE'] == null) {
  process.env['OTEL_SERVICE_NAMESPACE'] = 'kvorum';
}

if (process.env['OTEL_SERVICE_NAME'] == null) {
  process.env['OTEL_SERVICE_NAME'] = 'admin-cli';
}
