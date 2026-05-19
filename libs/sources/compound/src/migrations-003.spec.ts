import { sql } from 'kysely';
import { pgDb } from '@libs/db';
import {
  GOVERNOR_OZ_DEPLOY_BLOCK,
  down,
  up,
} from '../migrations-postgres/compound_003_governor_oz';

class RollbackSignal extends Error {}

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

describeWithDb('compound_003_governor_oz migration', () => {
  it('up inserts compound_governor_oz with correct deploy block', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`INSERT INTO source_type (value) VALUES ('compound_governor_oz')
                  ON CONFLICT DO NOTHING`.execute(tx);
        await sql`
          INSERT INTO dao (slug, name, primary_chain_id, updated_at)
          VALUES ('compound', 'Compound', '0x1', now())
          ON CONFLICT (slug) DO NOTHING
        `.execute(tx);

        await up(tx);

        const rows = await tx
          .selectFrom('dao_source')
          .select(['active_from_block'])
          .where('source_type', '=', 'compound_governor_oz')
          .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
          .where('dao.slug', '=', 'compound')
          .execute();

        expect(rows).toHaveLength(1);
        expect(rows[0]!.active_from_block).toBe(String(GOVERNOR_OZ_DEPLOY_BLOCK));

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('down removes only compound_governor_oz source type rows', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`INSERT INTO source_type (value) VALUES ('compound_governor_oz')
                  ON CONFLICT DO NOTHING`.execute(tx);
        await sql`
          INSERT INTO dao (slug, name, primary_chain_id, updated_at)
          VALUES ('compound', 'Compound', '0x1', now())
          ON CONFLICT (slug) DO NOTHING
        `.execute(tx);
        await up(tx);
        await down(tx);

        const rows = await tx
          .selectFrom('dao_source')
          .where('source_type', '=', 'compound_governor_oz')
          .execute();

        expect(rows).toHaveLength(0);
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
