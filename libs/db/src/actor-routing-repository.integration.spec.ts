import { ActorRoutingReadRepository } from './actor-routing-repository';
import { pgDb } from './client';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

class RollbackSignal extends Error {}

function uniqueAddress(seed: string): string {
  const suffix = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 8);
  const body = `${seed.repeat(32)}${suffix}`.slice(0, 40);
  return `0x${body}`;
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
          .values({ primary_address: uniqueAddress('a'), updated_at: new Date() })
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
        const survivorAddress = uniqueAddress('b');
        const mergedAddress = uniqueAddress('c');
        const [survivor] = await trx
          .insertInto('actor')
          .values({ primary_address: survivorAddress, updated_at: new Date() })
          .returning(['id'])
          .execute();

        await trx
          .insertInto('actor')
          .values({
            primary_address: mergedAddress,
            updated_at: new Date(),
            merged_into_actor_id: survivor!.id,
          })
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const row = await repo.findLiveActorByPrimaryAddress(mergedAddress);

        expect(row).toBeUndefined();
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findRedirect returns redirect target and survivor primary address', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const survivorAddress = uniqueAddress('d');
        const fromAddress = uniqueAddress('e');
        const [survivor] = await trx
          .insertInto('actor')
          .values({ primary_address: survivorAddress, updated_at: new Date() })
          .returning(['id', 'primary_address'])
          .execute();

        await trx
          .insertInto('actor_address_redirect')
          .values({
            from_address: fromAddress,
            to_actor_id: survivor!.id,
            merged_at: new Date(),
            merge_reason: 'test',
            created_by: 'test-suite',
          })
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const row = await repo.findRedirect(fromAddress.toUpperCase());

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
        const primaryAddress = uniqueAddress('f');
        const secondaryAddress = uniqueAddress('1');
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: primaryAddress, updated_at: new Date() })
          .returning(['id', 'primary_address'])
          .execute();

        await trx
          .insertInto('actor_address')
          .values({
            actor_id: actor!.id,
            address: secondaryAddress,
            is_primary: false,
            source: 'm1_backfill',
          })
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const row = await repo.findLiveActorByAnyAddress(secondaryAddress.toUpperCase());

        expect(row).toEqual({
          actor_id: actor!.id,
          primary_address: actor!.primary_address,
        });
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findCurrentActorIdsByAddresses resolves addresses through actor_redirect_view', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const primaryAddress = uniqueAddress('7');
        const fromAddress = uniqueAddress('8');
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: primaryAddress, updated_at: new Date() })
          .returning(['id', 'primary_address'])
          .execute();

        await trx
          .insertInto('actor_address_redirect')
          .values({
            from_address: fromAddress,
            to_actor_id: actor!.id,
            merged_at: new Date(),
            merge_reason: 'test',
            created_by: 'test-suite',
          })
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const rows = await repo.findCurrentActorIdsByAddresses([primaryAddress, fromAddress]);
        expect(rows.get(primaryAddress)).toBe(actor!.id);
        expect(rows.get(fromAddress)).toBe(actor!.id);
        expect(rows.get(uniqueAddress('9'))).toBeUndefined();
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
