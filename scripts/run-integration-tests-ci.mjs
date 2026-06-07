import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKAGES = [
  { name: '@sources/aave', expectedLabel: 'Aave', config: 'vitest.integration.config.mts' },
  {
    name: '@sources/compound',
    expectedLabel: 'Compound',
    config: 'vitest.integration.config.mts',
  },
];

const tempDir = mkdtempSync(join(tmpdir(), 'kvorum-integration-'));

try {
  for (const pkg of PACKAGES) {
    const outputFile = join(tempDir, `${pkg.name.replaceAll(/[^a-z0-9]+/gi, '_')}.json`);
    const result = spawnSync(
      'pnpm',
      [
        '--filter',
        pkg.name,
        'exec',
        'vitest',
        'run',
        '--config',
        pkg.config,
        '--reporter=json',
        `--outputFile=${outputFile}`,
      ],
      {
        stdio: 'inherit',
        env: process.env,
      },
    );

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }

    const report = JSON.parse(readFileSync(outputFile, 'utf8'));
    const totalTests = Number(report.numTotalTests ?? 0);
    if (!Number.isFinite(totalTests) || totalTests <= 0) {
      throw new Error(`${pkg.expectedLabel} integration suite executed zero tests`);
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
