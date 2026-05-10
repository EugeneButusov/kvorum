// Wrapper for clickhouse-migrations that handles the per-source directory layout.
// Each source package keeps its ClickHouse migrations at:
//   libs/sources/<name>/migrations-clickhouse/<source>_NNN_<name>.sql
// clickhouse-migrations takes a single --migrations-dir, so this script
// globs all per-source dirs, sorts files by basename, copies them into a
// single temp directory, and invokes the runner once.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.join(import.meta.dirname, '../../..');
const sourcesDir = path.join(repoRoot, 'libs/sources');

async function collectMigrations(): Promise<string[]> {
  const files: string[] = [];
  let sourceDirs: string[];
  try {
    sourceDirs = await fs.readdir(sourcesDir);
  } catch {
    // libs/sources does not exist yet (pre-PR-2)
    return [];
  }
  for (const source of sourceDirs) {
    const migrDir = path.join(sourcesDir, source, 'migrations-clickhouse');
    let entries: string[];
    try {
      entries = await fs.readdir(migrDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith('.sql')) {
        files.push(path.join(migrDir, entry));
      }
    }
  }
  // Sort by basename so compound_001 < compound_002 regardless of directory order.
  files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  return files;
}

async function run() {
  const files = await collectMigrations();
  if (files.length === 0) {
    console.log('[ch-migrate] No ClickHouse migrations to apply.');
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kvorum-ch-migrations-'));
  try {
    for (const file of files) {
      // clickhouse-migrations requires filenames to start with a number.
      // Source files use <source>_NNN_<name>.sql; strip the source prefix
      // so compound_001_archive.sql → 001_compound_archive.sql.
      const base = path.basename(file);
      const reordered = base.replace(/^([a-z_]+)_(\d+)_(.+)$/, '$2_$1_$3');
      await fs.copyFile(file, path.join(tmpDir, reordered));
    }
    console.log(`[ch-migrate] Applying ${files.length} migration(s) from ${tmpDir}`);

    // --host accepts a full URL (e.g. http://localhost:8123)
    const host = process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123';
    const database = process.env['CLICKHOUSE_DATABASE'] ?? 'default';
    const username = process.env['CLICKHOUSE_USER'] ?? 'default';
    const password = process.env['CLICKHOUSE_PASSWORD'] ?? '';

    const result = spawnSync(
      'npx',
      [
        'clickhouse-migrations',
        'migrate',
        '--host',
        host,
        '--db',
        database,
        '--user',
        username,
        '--password',
        password,
        '--migrations-home',
        tmpDir,
      ],
      { stdio: 'inherit' },
    );

    if (result.status !== 0) {
      console.error('[ch-migrate] clickhouse-migrations failed');
      process.exit(result.status ?? 1);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
}

await run();
