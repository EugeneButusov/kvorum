import { describe, expect, it } from 'vitest';
import { collectMigrations, validateMigrationBasenames } from './migrate-ch.mjs';

describe('ClickHouse migration filename convention', () => {
  it('collects migrations in embedded global-ordinal order', async () => {
    const basenames = (await collectMigrations()).map((file) => file.split('/').at(-1));

    expect(basenames).toEqual([
      '0001_core_ch_source_of_truth.sql',
      '0002_compound_archive.sql',
      '0003_compound_comp_token_archive.sql',
      '0004_aave_archive.sql',
    ]);
  });

  it('rejects missing global ordinal prefix', () => {
    expect(() => validateMigrationBasenames(['/repo/libs/sources/core/core_001.sql'])).toThrow(
      /must start with/,
    );
  });

  it('rejects duplicate global ordinal prefixes', () => {
    expect(() =>
      validateMigrationBasenames([
        '/repo/libs/sources/core/0001_core.sql',
        '/repo/libs/sources/compound/0001_compound.sql',
      ]),
    ).toThrow(/ordinal 0001/);
  });
});
