import { sql } from 'kysely';
import { pgDb } from '@libs/db';
import {
  GOVERNOR_ALPHA_DEPLOY_BLOCK,
  GOVERNOR_BRAVO_DEPLOY_BLOCK,
  GOVERNOR_OZ_DEPLOY_BLOCK,
  down as downCompoundSeed,
  up as upCompoundSeed,
} from '../migrations-postgres/compound_002_seed';
import {
  down as downCompToken,
  up as upCompToken,
} from '../migrations-postgres/compound_003_comp_token';
import { COMP_TOKEN_ADDRESS, COMP_TOKEN_DEPLOY_BLOCK } from './comp-token/constants';

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
          VALUES ('compound_governor_bravo'), ('compound_governor_alpha'), ('compound_governor_oz')
          ON CONFLICT DO NOTHING
        `.execute(tx);

        await upCompoundSeed(tx);

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
          VALUES ('compound_governor_bravo'), ('compound_governor_alpha'), ('compound_governor_oz')
          ON CONFLICT DO NOTHING
        `.execute(tx);

        await upCompoundSeed(tx);

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
          VALUES ('compound_governor_bravo'), ('compound_governor_alpha'), ('compound_governor_oz')
          ON CONFLICT DO NOTHING
        `.execute(tx);

        await upCompoundSeed(tx);
        await downCompoundSeed(tx);

        const daoRows = await tx.selectFrom('dao').where('slug', '=', 'compound').execute();
        expect(daoRows).toHaveLength(0);

        const sourceRows = await tx
          .selectFrom('dao_source')
          .where('source_type', 'in', [
            'compound_governor_bravo',
            'compound_governor_alpha',
            'compound_governor_oz',
          ])
          .execute();
        expect(sourceRows).toHaveLength(0);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('up inserts compound_governor_oz with correct deploy block', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`
          INSERT INTO source_type (value)
          VALUES ('compound_governor_bravo'), ('compound_governor_alpha'), ('compound_governor_oz')
          ON CONFLICT DO NOTHING
        `.execute(tx);

        await upCompoundSeed(tx);

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
});

describeWithDb('compound_003_comp_token migration', () => {
  it('up inserts source_type and dao_source with expected token config and deploy block', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await upCompoundSeed(tx);
        await upCompToken(tx);

        const sourceTypeRows = await tx
          .selectFrom('source_type')
          .select('value')
          .where('value', '=', 'compound_comp_token')
          .execute();
        expect(sourceTypeRows).toHaveLength(1);

        const rows = await tx
          .selectFrom('dao_source')
          .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
          .select(['dao_source.active_from_block', 'dao_source.source_config'])
          .where('dao.slug', '=', 'compound')
          .where('dao_source.source_type', '=', 'compound_comp_token')
          .execute();

        expect(rows).toHaveLength(1);
        expect(rows[0]!.active_from_block).toBe(String(COMP_TOKEN_DEPLOY_BLOCK));
        expect(rows[0]!.source_config).toEqual({
          token_address: COMP_TOKEN_ADDRESS,
        });

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('up is idempotent when executed twice', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await upCompoundSeed(tx);
        await upCompToken(tx);
        await upCompToken(tx);

        const sourceTypeRows = await tx
          .selectFrom('source_type')
          .select('value')
          .where('value', '=', 'compound_comp_token')
          .execute();
        expect(sourceTypeRows).toHaveLength(1);

        const sourceRows = await tx
          .selectFrom('dao_source')
          .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
          .select('dao_source.source_type')
          .where('dao.slug', '=', 'compound')
          .where('dao_source.source_type', '=', 'compound_comp_token')
          .execute();
        expect(sourceRows).toHaveLength(1);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('down after up removes dao_source row and source_type row', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await upCompoundSeed(tx);
        await upCompToken(tx);
        await downCompToken(tx);

        const sourceTypeRows = await tx
          .selectFrom('source_type')
          .select('value')
          .where('value', '=', 'compound_comp_token')
          .execute();
        expect(sourceTypeRows).toHaveLength(0);

        const sourceRows = await tx
          .selectFrom('dao_source')
          .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
          .select('dao_source.source_type')
          .where('dao.slug', '=', 'compound')
          .where('dao_source.source_type', '=', 'compound_comp_token')
          .execute();
        expect(sourceRows).toHaveLength(0);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
