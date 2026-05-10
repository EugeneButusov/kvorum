import { pgDb } from '../src/client';
import { seedCompound } from '../../sources/compound/src/seed';

await pgDb
  .transaction()
  .execute(async (tx) => {
    await seedCompound(tx);
  })
  .then(() => {
    console.log('[seed] Compound seed complete.');
  })
  .catch((err: unknown) => {
    console.error('[seed] Seed failed:', err);
    process.exit(1);
  });

await pgDb.destroy();
