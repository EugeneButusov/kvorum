import { FileMigrationProvider, Migrator } from 'kysely';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pgDb } from '../src/client';

const migrationsDir = path.join(import.meta.dirname, '../migrations');

const migrator = new Migrator({
  db: pgDb,
  provider: new FileMigrationProvider({ fs, path, migrationFolder: migrationsDir }),
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
  console.error(`Usage: migrate.ts <up|down|reset>`);
  process.exit(1);
}
