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

  it('findMergeMap maps a merged actor absorbed addresses onto its canonical address', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const survivorPrimary = uniqueAddress('a');
        const absorbed = uniqueAddress('b');
        const soloAddress = uniqueAddress('c');

        const [survivor] = await trx
          .insertInto('actor')
          .values({ primary_address: survivorPrimary, updated_at: new Date() })
          .returning(['id'])
          .execute();
        const [solo] = await trx
          .insertInto('actor')
          .values({ primary_address: soloAddress, updated_at: new Date() })
          .returning(['id'])
          .execute();
        // The shape executeMerge leaves behind: both addresses retargeted onto the survivor.
        await trx
          .insertInto('actor_address')
          .values([
            {
              actor_id: survivor!.id,
              address: survivorPrimary,
              is_primary: true,
              source: 'manual',
            },
            { actor_id: survivor!.id, address: absorbed, is_primary: false, source: 'manual' },
            { actor_id: solo!.id, address: soloAddress, is_primary: true, source: 'manual' },
          ])
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const map = await repo.findMergeMap();
        const mine = map.filter((entry) =>
          [survivorPrimary, absorbed, soloAddress].includes(entry.address),
        );

        // Only the absorbed address is non-canonical. The survivor's own primary address and the
        // unmerged actor contribute nothing — on a database with no merges the map is empty, and
        // the ClickHouse transform() built from it degenerates to the identity.
        expect(mine).toEqual([{ address: absorbed, canonicalAddress: survivorPrimary }]);
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findMergeMap canonical addresses resolve back to their actor, closing the round trip', async () => {
    // The two halves must compose: analytics groups on the canonical address in ClickHouse, then
    // maps those addresses back to actor ids through findCurrentActorIdsByAddresses. If a canonical
    // address did not resolve, the grouped row would come back with no actor.
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const survivorPrimary = uniqueAddress('d');
        const absorbed = uniqueAddress('e');
        const [survivor] = await trx
          .insertInto('actor')
          .values({ primary_address: survivorPrimary, updated_at: new Date() })
          .returning(['id'])
          .execute();
        await trx
          .insertInto('actor_address')
          .values([
            {
              actor_id: survivor!.id,
              address: survivorPrimary,
              is_primary: true,
              source: 'manual',
            },
            { actor_id: survivor!.id, address: absorbed, is_primary: false, source: 'manual' },
          ])
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const map = await repo.findMergeMap();
        const canonical = map.find((entry) => entry.address === absorbed)?.canonicalAddress;
        expect(canonical).toBe(survivorPrimary);

        const resolved = await repo.findCurrentActorIdsByAddresses([canonical!]);
        expect(resolved.get(canonical!)).toBe(survivor!.id);
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('resolves a canonical address that has no actor_address row, via the primary_address arm', async () => {
    // findOrCreateActorAddress inserts the actor and its address as two statements with no enclosing
    // transaction, so a crash between them leaves an actor whose primary_address has no
    // actor_address row. findMergeMap canonicalises onto primary_address regardless, so without the
    // coalesce's `a.id` arm that canonical address would resolve to no actor at all. This is what
    // makes that arm load-bearing rather than merely defensive (ADR-087 open question 3).
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const orphanPrimary = uniqueAddress('f');
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: orphanPrimary, updated_at: new Date() })
          .returning(['id'])
          .execute();

        const repo = new ActorRoutingReadRepository(trx as never);
        const resolved = await repo.findCurrentActorIdsByAddresses([orphanPrimary]);

        expect(resolved.get(orphanPrimary)).toBe(actor!.id);
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
