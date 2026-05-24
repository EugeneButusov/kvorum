import { ActorRoutingReadRepository } from './actor-routing-repository';
import { pgDb } from './client';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

class RollbackSignal extends Error {}

function hexAddress(fill: string): string {
  return `0x${fill.repeat(40).slice(0, 40)}`;
}

afterAll(async () => {
  await pgDb.destroy();
});

describeWithDb('ActorRoutingReadRepository (integration)', () => {
  it('findLiveActorByPrimaryAddress returns live actor for primary address', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: hexAddress('a'), updated_at: new Date() })
          .returningAll()
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const row = await repo.findLiveActorByPrimaryAddress(actor!.primary_address.toUpperCase());

        expect(row?.id).toBe(actor?.id);
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findLiveActorByPrimaryAddress excludes merged actors', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [survivor] = await trx
          .insertInto('actor')
          .values({ primary_address: hexAddress('b'), updated_at: new Date() })
          .returning(['id'])
          .execute();

        await trx
          .insertInto('actor')
          .values({
            primary_address: hexAddress('c'),
            updated_at: new Date(),
            merged_into_actor_id: survivor!.id,
          })
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const row = await repo.findLiveActorByPrimaryAddress(hexAddress('c'));

        expect(row).toBeUndefined();
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findRedirect returns redirect target and survivor primary address', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [survivor] = await trx
          .insertInto('actor')
          .values({ primary_address: hexAddress('d'), updated_at: new Date() })
          .returning(['id', 'primary_address'])
          .execute();

        await trx
          .insertInto('actor_address_redirect')
          .values({
            from_address: hexAddress('e'),
            to_actor_id: survivor!.id,
            merged_at: new Date(),
            merge_reason: 'test',
            created_by: 'test-suite',
          })
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const row = await repo.findRedirect(hexAddress('e').toUpperCase());

        expect(row).toEqual({
          to_actor_id: survivor!.id,
          survivor_primary_address: survivor!.primary_address,
        });
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findLiveActorByAnyAddress returns actor_id and primary_address for non-primary address', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: hexAddress('f'), updated_at: new Date() })
          .returning(['id', 'primary_address'])
          .execute();

        await trx
          .insertInto('actor_address')
          .values({
            actor_id: actor!.id,
            address: hexAddress('1'),
            is_primary: false,
            source: 'm1_backfill',
          })
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const row = await repo.findLiveActorByAnyAddress(hexAddress('1').toUpperCase());

        expect(row).toEqual({
          actor_id: actor!.id,
          primary_address: actor!.primary_address,
        });
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
