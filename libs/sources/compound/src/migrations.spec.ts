import { sql } from 'kysely';
import { pgDb } from '@libs/db';
import {
  GOVERNOR_ALPHA_DEPLOY_BLOCK,
  GOVERNOR_BRAVO_DEPLOY_BLOCK,
  down,
  up,
} from '../migrations-postgres/compound_002_seed';

// Sentinel thrown inside transaction to trigger intentional rollback.
class RollbackSignal extends Error {}

// These tests require a running Postgres instance (DATABASE_URL env var).
// They are skipped when DATABASE_URL is not set so the suite passes in
// environments without a DB (e.g. pure typecheck CI steps).
const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

describeWithDb('compound_002_seed migration', () => {
  it('up inserts compound_governor_bravo with correct deploy block', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`
          INSERT INTO source_type (value)
          VALUES ('compound_governor_bravo'), ('compound_governor_alpha')
          ON CONFLICT DO NOTHING
        `.execute(tx);

        await up(tx);

        const rows = await tx
          .selectFrom('dao_source')
          .select(['active_from_block'])
          .where('source_type', '=', 'compound_governor_bravo')
          .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
          .where('dao.slug', '=', 'compound')
          .execute();

        expect(rows).toHaveLength(1);
        expect(rows[0]!.active_from_block).toBe(String(GOVERNOR_BRAVO_DEPLOY_BLOCK));

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('up inserts compound_governor_alpha with correct deploy block', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`
          INSERT INTO source_type (value)
          VALUES ('compound_governor_bravo'), ('compound_governor_alpha')
          ON CONFLICT DO NOTHING
        `.execute(tx);

        await up(tx);

        const rows = await tx
          .selectFrom('dao_source')
          .select(['active_from_block'])
          .where('source_type', '=', 'compound_governor_alpha')
          .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
          .where('dao.slug', '=', 'compound')
          .execute();

        expect(rows).toHaveLength(1);
        expect(rows[0]!.active_from_block).toBe(String(GOVERNOR_ALPHA_DEPLOY_BLOCK));

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('down removes the compound dao and its sources', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`
          INSERT INTO source_type (value)
          VALUES ('compound_governor_bravo'), ('compound_governor_alpha')
          ON CONFLICT DO NOTHING
        `.execute(tx);

        await up(tx);
        await down(tx);

        const daoRows = await tx.selectFrom('dao').where('slug', '=', 'compound').execute();
        expect(daoRows).toHaveLength(0);

        const sourceRows = await tx
          .selectFrom('dao_source')
          .where('source_type', 'in', ['compound_governor_bravo', 'compound_governor_alpha'])
          .execute();
        expect(sourceRows).toHaveLength(0);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
