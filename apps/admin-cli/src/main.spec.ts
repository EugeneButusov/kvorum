import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(__dirname, '../../../dist/apps/admin-cli/main.js');
const BUNDLE_ENV = {
  ...process.env,
  OTEL_SERVICE_NAMESPACE: process.env['OTEL_SERVICE_NAMESPACE'] ?? 'kvorum',
  OTEL_SERVICE_NAME: process.env['OTEL_SERVICE_NAME'] ?? 'admin-cli',
};

describe('admin-cli bundle smoke test', () => {
  it('prints version matching package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
      version: string;
    };
    const out = execFileSync('node', [BUNDLE, '--version'], { encoding: 'utf8', env: BUNDLE_ENV });
    expect(out.trim()).toBe(pkg.version);
  });

  it('exits 69 and writes JSON to stdout with ADMIN_FORMAT=json', () => {
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      execFileSync('node', [BUNDLE, 'maintenance', 'disable'], {
        encoding: 'utf8',
        env: { ...BUNDLE_ENV, ADMIN_FORMAT: 'json' },
      });
    } catch (err: unknown) {
      const e = err as { status: number; stdout: string; stderr: string };
      exitCode = e.status;
      stdout = e.stdout;
      stderr = e.stderr;
    }
    expect(exitCode).toBe(69);
    expect(JSON.parse(stdout)).toMatchObject({
      error: 'not_implemented',
      command: 'maintenance disable',
    });
    expect(stderr).toBe('');
  });

  it('exits 69 and writes human text to stderr by default', () => {
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      execFileSync('node', [BUNDLE, 'maintenance', 'disable'], {
        encoding: 'utf8',
        env: BUNDLE_ENV,
      });
    } catch (err: unknown) {
      const e = err as { status: number; stdout: string; stderr: string };
      exitCode = e.status;
      stdout = e.stdout;
      stderr = e.stderr;
    }
    expect(exitCode).toBe(69);
    expect(stdout).toBe('');
    expect(stderr).toContain('not yet implemented in M0');
  });
});
