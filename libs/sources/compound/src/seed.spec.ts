import { pgDb } from '@libs/db';
import { seedCompound } from './seed';

class RollbackSignal extends Error {}

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

describeWithDb('Compound seed idempotency', () => {
  afterAll(async () => {
    await pgDb.destroy();
  });

  it('runs twice inside a transaction without errors and produces no duplicates', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await seedCompound(tx);

        const afterFirst = await tx
          .selectFrom('dao')
          .where('slug', '=', 'compound')
          .selectAll()
          .execute();
        expect(afterFirst).toHaveLength(1);

        // Second run must be idempotent — ON CONFLICT DO NOTHING on both inserts.
        await seedCompound(tx);

        const afterSecond = await tx
          .selectFrom('dao')
          .where('slug', '=', 'compound')
          .selectAll()
          .execute();
        expect(afterSecond).toHaveLength(1);

        const sources = await tx
          .selectFrom('dao_source')
          .where('dao_id', '=', afterSecond[0]!.id)
          .selectAll()
          .execute();
        expect(sources).toHaveLength(1);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
