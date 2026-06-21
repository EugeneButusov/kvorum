import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env['OTEL_SERVICE_NAMESPACE'] = 'test';
process.env['OTEL_SERVICE_NAME'] = 'test';

const envPath = resolve(__dirname, '../../../.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] != null) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

process.env['CLICKHOUSE_URL'] ??= 'http://localhost:8123';
