import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Migration, MigrationProvider } from 'kysely';
import { Migrator } from 'kysely/migration';
import { pgDb } from '../src/client';

const repoRoot = path.join(import.meta.dirname, '../../..');
const coreMigrationsDir = path.join(import.meta.dirname, '../migrations');
const sourcesDir = path.join(repoRoot, 'libs/sources');

// Merges libs/db/migrations/ with libs/sources/*/migrations-postgres/ and sorts
// by filename. Convention: core files are 0NNN_*, source files are <source>_NNN_*,
// so alphabetical order naturally puts core before source (e.g. 0002 < compound_001).
// We enable allowUnorderedMigrations below because new source families can be
// introduced after older families have already executed in persistent databases.
class MultiDirMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    const entries: { name: string; filePath: string }[] = [];

    for (const file of await fs.readdir(coreMigrationsDir)) {
      if (file.endsWith('.ts') || file.endsWith('.js')) {
        entries.push({
          name: path.basename(file, path.extname(file)),
          filePath: path.join(coreMigrationsDir, file),
        });
      }
    }

    let sourceDirs: string[];
    try {
      sourceDirs = await fs.readdir(sourcesDir);
    } catch {
      sourceDirs = [];
    }
    for (const source of sourceDirs) {
      const migrDir = path.join(sourcesDir, source, 'migrations-postgres');
      let files: string[];
      try {
        files = await fs.readdir(migrDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.endsWith('.ts') || file.endsWith('.js')) {
          entries.push({
            name: path.basename(file, path.extname(file)),
            filePath: path.join(migrDir, file),
          });
        }
      }
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    const migrations: Record<string, Migration> = {};
    for (const entry of entries) {
      migrations[entry.name] = await import(entry.filePath);
    }
    return migrations;
  }
}

const migrator = new Migrator({
  db: pgDb,
  provider: new MultiDirMigrationProvider(),
  allowUnorderedMigrations: true,
});

async function up() {
  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`[up] ${result.migrationName}: applied`);
    } else if (result.status === 'Error') {
      console.error(`[up] ${result.migrationName}: failed`);
    }
  }
  if (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
  if (!results?.length) {
    console.log('[up] No migrations to apply.');
  }
  await pgDb.destroy();
}

async function down() {
  const { error, results } = await migrator.migrateDown();
  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`[down] ${result.migrationName}: rolled back`);
    } else if (result.status === 'Error') {
      console.error(`[down] ${result.migrationName}: failed`);
    }
  }
  if (error) {
    console.error('Migration rollback failed:', error);
    process.exit(1);
  }
  await pgDb.destroy();
}

async function reset() {
  const { error, results } = await migrator.migrateTo(Migrator.NO_MIGRATIONS);
  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`[reset] ${result.migrationName}: rolled back`);
    }
  }
  if (error) {
    console.error('Reset failed:', error);
    process.exit(1);
  }
  console.log('[reset] All migrations rolled back.');
  await pgDb.destroy();
}

const cmd = process.argv[2];
if (cmd === 'up') {
  await up();
} else if (cmd === 'down') {
  await down();
} else if (cmd === 'reset') {
  await reset();
} else {
  console.error(`Usage: migrate.mts <up|down|reset>`);
  process.exit(1);
}
