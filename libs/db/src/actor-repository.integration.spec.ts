import { ActorRepository } from './actor-repository';
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

describeWithDb('ActorRepository (integration)', () => {
  it('listAddressesForActor returns [] when actor has no actor_address rows', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: uniqueAddress('a'), updated_at: new Date() })
          .returning(['id'])
          .execute();

        const repo = new ActorRepository(trx as never);
        const rows = await repo.listAddressesForActor(actor!.id);
        expect(rows).toEqual([]);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('listAddressesForActor orders rows by is_primary desc then address asc', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: uniqueAddress('b'), updated_at: new Date() })
          .returning(['id'])
          .execute();

        const addresses = [uniqueAddress('c'), uniqueAddress('d'), uniqueAddress('e')].sort();
        await trx
          .insertInto('actor_address')
          .values([
            {
              actor_id: actor!.id,
              address: addresses[1]!,
              is_primary: false,
              source: 'voter_event',
            },
            {
              actor_id: actor!.id,
              address: addresses[2]!,
              is_primary: false,
              source: 'delegate_event',
            },
            {
              actor_id: actor!.id,
              address: addresses[0]!,
              is_primary: true,
              source: 'proposer_event',
            },
          ])
          .execute();

        const repo = new ActorRepository(trx as never);
        const rows = await repo.listAddressesForActor(actor!.id);

        expect(rows.map((row) => row.address)).toEqual([
          addresses[0],
          ...addresses.slice(1).sort((left, right) => left.localeCompare(right)),
        ]);
        expect(rows[0]?.is_primary).toBe(true);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('listAddressesForActor returns all addresses for an actor', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: uniqueAddress('f'), updated_at: new Date() })
          .returning(['id'])
          .execute();

        const rowsToInsert = [0, 1, 2, 3, 4].map((idx) => ({
          actor_id: actor!.id,
          address: uniqueAddress((idx + 1).toString(16)),
          is_primary: idx === 0,
          source: 'voter_event' as const,
        }));
        await trx.insertInto('actor_address').values(rowsToInsert).execute();

        const repo = new ActorRepository(trx as never);
        const rows = await repo.listAddressesForActor(actor!.id);

        expect(rows).toHaveLength(5);
        expect(rows.every((row) => row.actor_id === actor!.id)).toBe(true);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('listAddressesForActor excludes addresses from other actors', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [actorA] = await trx
          .insertInto('actor')
          .values({ primary_address: uniqueAddress('7'), updated_at: new Date() })
          .returning(['id'])
          .execute();
        const [actorB] = await trx
          .insertInto('actor')
          .values({ primary_address: uniqueAddress('8'), updated_at: new Date() })
          .returning(['id'])
          .execute();

        await trx
          .insertInto('actor_address')
          .values([
            {
              actor_id: actorA!.id,
              address: uniqueAddress('9'),
              is_primary: true,
              source: 'delegator_event',
            },
            {
              actor_id: actorB!.id,
              address: uniqueAddress('a'),
              is_primary: true,
              source: 'delegate_event',
            },
          ])
          .execute();

        const repo = new ActorRepository(trx as never);
        const rows = await repo.listAddressesForActor(actorA!.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.actor_id).toBe(actorA!.id);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
