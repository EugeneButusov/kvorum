import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { ActorMergeRepository } from './actor-merge-repository';
import { pgDb } from './client';
import { withAudit } from '../../../apps/admin-cli/src/audit.js';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

function uniqueAddress(seed: string): string {
  const hex = (seed + Date.now().toString(16) + Math.random().toString(16).slice(2))
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
    .padEnd(40, '0')
    .slice(0, 40);
  return `0x${hex}`;
}

async function seedMergeFixture(
  trx: typeof pgDb,
  seed: string,
): Promise<{
  survivorAddress: string;
  secondaryPrimaryAddress: string;
  secondaryAliasAddress: string;
  secondaryActorId: string;
  survivorActorId: string;
  proposalId: string;
}> {
  const now = new Date();
  const daoSlug = `actor-merge-${seed}-${Date.now()}`;
  const [dao] = await trx
    .insertInto('dao')
    .values({
      slug: daoSlug,
      name: `Actor Merge ${seed}`,
      primary_token_address: uniqueAddress(`${seed}t`),
      primary_chain_id: '1',
      description: '',
      website_url: '',
      forum_url: '',
      updated_at: now,
    })
    .returning(['id'])
    .execute();

  const survivorAddress = uniqueAddress(`${seed}1`);
  const secondaryPrimaryAddress = uniqueAddress(`${seed}2`);
  const secondaryAliasAddress = uniqueAddress(`${seed}3`);

  const [survivor] = await trx
    .insertInto('actor')
    .values({ primary_address: survivorAddress, updated_at: now })
    .returning(['id'])
    .execute();
  const [secondary] = await trx
    .insertInto('actor')
    .values({ primary_address: secondaryPrimaryAddress, updated_at: now })
    .returning(['id'])
    .execute();

  await trx
    .insertInto('actor_address')
    .values([
      { actor_id: survivor!.id, address: survivorAddress, is_primary: true, source: 'manual' },
      {
        actor_id: secondary!.id,
        address: secondaryPrimaryAddress,
        is_primary: true,
        source: 'manual',
      },
      {
        actor_id: secondary!.id,
        address: secondaryAliasAddress,
        is_primary: false,
        source: 'manual',
      },
    ])
    .execute();

  const [proposal] = await trx
    .insertInto('proposal')
    .values({
      dao_id: dao!.id,
      source_type: 'compound_governor_bravo',
      source_id: `proposal-${seed}-${Date.now()}`,
      proposer_actor_id: secondary!.id,
      title: null,
      description: 'merge smoke',
      description_hash: 'a'.repeat(64),
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: '1',
      voting_ends_block: '2',
      state: 'active',
      state_updated_at: now,
      updated_at: now,
    })
    .returning(['id'])
    .execute();

  await trx
    .insertInto('actor_address_redirect')
    .values({
      from_address: uniqueAddress(`${seed}5`),
      to_actor_id: secondary!.id,
      merged_at: now,
      merge_reason: 'seed redirect',
      created_by: 'seed',
    })
    .execute();

  return {
    survivorAddress,
    secondaryPrimaryAddress,
    secondaryAliasAddress,
    secondaryActorId: secondary!.id,
    survivorActorId: survivor!.id,
    proposalId: proposal!.id,
  };
}

async function assertRedirectFlattenInvariant(): Promise<void> {
  const row = await pgDb
    .selectFrom('actor_address_redirect as r')
    .innerJoin('actor as a', 'a.id', 'r.to_actor_id')
    .select('r.from_address')
    .where('a.merged_into_actor_id', 'is not', null)
    .executeTakeFirst();
  expect(row).toBeUndefined();
}

describeWithDb('ActorMergeRepository (integration)', () => {
  it('rewrites proposer FK, retargets actor addresses, and marks the secondary merged', async () => {
    const fixture = await seedMergeFixture(pgDb as never, 'a');
    const repo = new ActorMergeRepository(pgDb);

    await repo.executeMerge({
      primaryAddress: fixture.survivorAddress,
      secondaryAddress: fixture.secondaryPrimaryAddress,
      mergeReason: 'same delegate',
      createdBy: 'alice',
    });

    const [proposalCount] = await Promise.all([
      pgDb
        .selectFrom('proposal')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('proposer_actor_id', '=', fixture.secondaryActorId)
        .executeTakeFirst(),
    ]);

    expect(Number(proposalCount?.count ?? 0)).toBe(0);

    const addresses = await pgDb
      .selectFrom('actor_address')
      .select(['actor_id', 'address', 'is_primary'])
      .where('actor_id', '=', fixture.survivorActorId)
      .orderBy('address', 'asc')
      .execute();
    expect(addresses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: fixture.survivorAddress, is_primary: true }),
        expect.objectContaining({ address: fixture.secondaryPrimaryAddress, is_primary: false }),
        expect.objectContaining({ address: fixture.secondaryAliasAddress, is_primary: false }),
      ]),
    );

    const mergedSecondary = await pgDb
      .selectFrom('actor')
      .select(['merged_into_actor_id'])
      .where('id', '=', fixture.secondaryActorId)
      .executeTakeFirstOrThrow();
    expect(mergedSecondary.merged_into_actor_id).toBe(fixture.survivorActorId);

    const redirect = await pgDb
      .selectFrom('actor_address_redirect')
      .select(['from_address', 'to_actor_id', 'merge_reason', 'created_by'])
      .where('from_address', '=', fixture.secondaryPrimaryAddress)
      .executeTakeFirstOrThrow();
    expect(redirect.to_actor_id).toBe(fixture.survivorActorId);
    expect(redirect.merge_reason).toBe('same delegate');
    expect(redirect.created_by).toBe('alice');
  });

  it('flattens redirects pointing at the merged actor', async () => {
    const fixture = await seedMergeFixture(pgDb as never, 'b');
    const predecessor = uniqueAddress('pred');
    await pgDb
      .insertInto('actor_address_redirect')
      .values({
        from_address: predecessor,
        to_actor_id: fixture.secondaryActorId,
        merged_at: new Date(),
        merge_reason: 'previous merge',
        created_by: 'bob',
      })
      .execute();

    const repo = new ActorMergeRepository(pgDb);
    await repo.executeMerge({
      primaryAddress: fixture.survivorAddress,
      secondaryAddress: fixture.secondaryPrimaryAddress,
      mergeReason: 'same delegate',
      createdBy: 'alice',
    });

    const flattened = await pgDb
      .selectFrom('actor_address_redirect')
      .select(['from_address', 'to_actor_id'])
      .where('from_address', '=', predecessor)
      .executeTakeFirstOrThrow();
    expect(flattened.to_actor_id).toBe(fixture.survivorActorId);
    await assertRedirectFlattenInvariant();
  });

  it('rejects re-merging after the secondary address is absorbed by the survivor', async () => {
    const fixture = await seedMergeFixture(pgDb as never, 'c');
    const repo = new ActorMergeRepository(pgDb);

    await repo.executeMerge({
      primaryAddress: fixture.survivorAddress,
      secondaryAddress: fixture.secondaryPrimaryAddress,
      mergeReason: 'same delegate',
      createdBy: 'alice',
    });

    await expect(
      repo.executeMerge({
        primaryAddress: fixture.survivorAddress,
        secondaryAddress: fixture.secondaryPrimaryAddress,
        mergeReason: 'same delegate',
        createdBy: 'alice',
      }),
    ).rejects.toThrow('resolve to the same actor');
  });

  it('writes an admin_audit row when wrapped with withAudit', async () => {
    const fixture = await seedMergeFixture(pgDb as never, 'd');
    const repo = new ActorMergeRepository(pgDb);

    await withAudit(
      'actors merge',
      {
        primary_address: fixture.survivorAddress,
        secondary_address: fixture.secondaryPrimaryAddress,
        reason: 'same delegate',
        dry_run: false,
      },
      async () =>
        repo.executeMerge({
          primaryAddress: fixture.survivorAddress,
          secondaryAddress: fixture.secondaryPrimaryAddress,
          mergeReason: 'same delegate',
          createdBy: 'alice',
        }),
    );

    const audit = await pgDb
      .selectFrom('admin_audit')
      .selectAll()
      .where('command', '=', 'actors merge')
      .orderBy('started_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(audit.outcome).toBe('success');
    expect(audit.args).toMatchObject({
      primary_address: fixture.survivorAddress,
      secondary_address: fixture.secondaryPrimaryAddress,
      dry_run: false,
      reason: 'same delegate',
    });
    await assertRedirectFlattenInvariant();
  });

  it('enforces lowercase check for actor.primary_address', async () => {
    await expect(
      sql`insert into actor (primary_address, updated_at) values ('0xAbCd000000000000000000000000000000000000', now())`.execute(
        pgDb,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
