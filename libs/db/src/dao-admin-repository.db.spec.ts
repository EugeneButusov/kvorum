import { pgDb } from './client';
import { DaoAdminRepository } from './dao-admin-repository';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

class RollbackSignal extends Error {}

afterAll(async () => {
  await pgDb.destroy();
});

function uniqueSlug() {
  return `dao-admin-spec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describeWithDb('DaoAdminRepository (integration)', () => {
  it('createDao() persists a DAO with all required fields', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DaoAdminRepository(trx as never);
        const slug = uniqueSlug();
        const dao = await repo.createDao({
          slug,
          name: 'Test DAO',
          primaryTokenAddress: '0x' + 'a'.repeat(40),
          primaryChainId: '1',
        });

        expect(dao.id).toBeDefined();
        expect(dao.slug).toBe(slug);
        expect(dao.name).toBe('Test DAO');
        expect(dao.primary_token_address).toBe('0x' + 'a'.repeat(40));
        expect(dao.description).toBe('');
        expect(dao.website_url).toBe('');
        expect(dao.forum_url).toBe('');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findDaoBySlug() returns id+slug for existing DAO and undefined for missing', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DaoAdminRepository(trx as never);
        const slug = uniqueSlug();
        const created = await repo.createDao({
          slug,
          name: 'Find Test',
          primaryTokenAddress: '0x' + 'b'.repeat(40),
          primaryChainId: '1',
        });

        const found = await repo.findDaoBySlug(slug);
        expect(found?.id).toBe(created.id);
        expect(found?.slug).toBe(slug);

        const missing = await repo.findDaoBySlug('definitely-does-not-exist-xyz');
        expect(missing).toBeUndefined();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('addSource() links a compound_governor source to the DAO', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DaoAdminRepository(trx as never);
        const dao = await repo.createDao({
          slug: uniqueSlug(),
          name: 'Source Test',
          primaryTokenAddress: '0x' + 'c'.repeat(40),
          primaryChainId: '1',
        });

        const source = await repo.addSource({
          daoId: dao.id,
          sourceType: 'compound_governor',
          sourceConfig: { governor_address: '0x' + 'd'.repeat(40) },
        });

        expect(source.id).toBeDefined();
        expect(source.dao_id).toBe(dao.id);
        expect(source.source_type).toBe('compound_governor');
        expect(source.source_config).toEqual({ governor_address: '0x' + 'd'.repeat(40) });

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('updateSourceConfig() returns 1 on update and 0 on not-found', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DaoAdminRepository(trx as never);
        const dao = await repo.createDao({
          slug: uniqueSlug(),
          name: 'Update Test',
          primaryTokenAddress: '0x' + 'e'.repeat(40),
          primaryChainId: '1',
        });
        const source = await repo.addSource({
          daoId: dao.id,
          sourceType: 'compound_governor',
          sourceConfig: { governor_address: '0x' + 'f'.repeat(40) },
        });

        const newCfg = { governor_address: '0x' + '1'.repeat(40) };
        const count = await repo.updateSourceConfig(source.id, newCfg);
        expect(count).toBe(1);

        const updated = await repo.findSourceById(source.id);
        expect(updated?.source_config).toEqual(newCfg);

        const notFound = await repo.updateSourceConfig('00000000-0000-0000-0000-000000000000', {});
        expect(notFound).toBe(0);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findSourceById() returns the source or undefined', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DaoAdminRepository(trx as never);
        const dao = await repo.createDao({
          slug: uniqueSlug(),
          name: 'Find Source',
          primaryTokenAddress: '0x' + 'a'.repeat(40),
          primaryChainId: '1',
        });
        const source = await repo.addSource({
          daoId: dao.id,
          sourceType: 'compound_governor',
          sourceConfig: { governor_address: '0x' + 'b'.repeat(40) },
        });

        const found = await repo.findSourceById(source.id);
        expect(found?.id).toBe(source.id);
        expect(found?.source_type).toBe('compound_governor');

        const missing = await repo.findSourceById('00000000-0000-0000-0000-000000000000');
        expect(missing).toBeUndefined();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('sourceTypeExists() returns true for compound_governor and false for unknown types', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new DaoAdminRepository(trx as never);

        expect(await repo.sourceTypeExists('compound_governor')).toBe(true);
        expect(await repo.sourceTypeExists('nonexistent_source_type_xyz')).toBe(false);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
