import { pgDb } from './client';

// Sentinel thrown inside transaction to trigger intentional rollback.
class RollbackSignal extends Error {}

// These tests require a running Postgres instance (DATABASE_URL env var).
// They are skipped when DATABASE_URL is not set so the suite passes in
// environments without a DB (e.g. pure typecheck CI steps).
const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

// Single teardown shared across all suites — pgDb is a module-level singleton.
afterAll(async () => {
  await pgDb.destroy();
});

describeWithDb('auth schema smoke test', () => {
  it('inserts users, api_key, admin_audit rows and rolls back', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        const [user] = await tx
          .insertInto('users')
          .values({
            email: 'smoke@example.com',
            display_name: 'Smoke User',
            role: 'admin',
            updated_at: new Date(),
          })
          .returning(['id'])
          .execute();

        await tx
          .insertInto('api_key')
          .values({
            user_id: user!.id,
            key_hash: Buffer.from('a'.repeat(32)),
            prefix: 'kv_live_',
            last_four: 'abcd',
            tier: 'authenticated_free',
          })
          .execute();

        await tx
          .insertInto('admin_audit')
          .values({
            command: 'keys create',
            args: { label: 'smoke' },
            executor: 'smoke@example.com',
            executor_kind: 'ssh',
          })
          .execute();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);

    // Verify no rows persisted after rollback.
    const users = await pgDb
      .selectFrom('users')
      .where('email', '=', 'smoke@example.com')
      .selectAll()
      .execute();
    expect(users).toHaveLength(0);
  });
});

describeWithDb('ingestion domain smoke test', () => {
  it('inserts dao, dao_source, actor, proposal, proposal_action, proposal_choice, archive_confirmation and rolls back', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        const [dao] = await tx
          .insertInto('dao')
          .values({
            slug: 'smoke-dao',
            name: 'Smoke DAO',
            primary_token_address: '0x' + 'a'.repeat(40),
            primary_chain_id: 1,
            description: 'smoke',
            website_url: 'https://smoke.example.com',
            forum_url: 'https://forum.smoke.example.com',
            updated_at: new Date(),
          })
          .returning(['id'])
          .execute();

        const [daoSource] = await tx
          .insertInto('dao_source')
          .values({
            dao_id: dao!.id,
            source_type: 'compound_governor_bravo',
            source_config: { governor_address: '0x' + 'b'.repeat(40) },
          })
          .returning(['id'])
          .execute();

        const [actor] = await tx
          .insertInto('actor')
          .values({
            primary_address: '0x' + 'c'.repeat(40),
            updated_at: new Date(),
          })
          .returning(['id'])
          .execute();

        const now = new Date();
        const [proposal] = await tx
          .insertInto('proposal')
          .values({
            dao_id: dao!.id,
            source_type: 'compound_governor_bravo',
            source_id: 'smoke-1',
            proposer_actor_id: actor!.id,
            description: 'smoke proposal',
            description_hash: 'a'.repeat(64),
            binding: true,
            voting_starts_at: null,
            voting_ends_at: null,
            voting_starts_block: '12345678',
            voting_ends_block: '12365432',
            voting_power_block: '12345678',
            state: 'active',
            state_updated_at: now,
            updated_at: now,
          })
          .returning(['id'])
          .execute();

        await tx
          .insertInto('proposal_action')
          .values({
            proposal_id: proposal!.id,
            action_index: 0,
            target_address: '0x' + 'd'.repeat(40),
            target_chain_id: 1,
            value_wei: '0',
            calldata: '0x',
          })
          .execute();

        await tx
          .insertInto('proposal_choice')
          .values([
            { proposal_id: proposal!.id, choice_index: 0, value: 'against' },
            { proposal_id: proposal!.id, choice_index: 1, value: 'for' },
            { proposal_id: proposal!.id, choice_index: 2, value: 'abstain' },
          ])
          .execute();

        await tx
          .insertInto('archive_confirmation')
          .values({
            source_type: 'compound_governor_bravo',
            dao_source_id: daoSource!.id,
            chain_id: 1,
            block_number: '12345678',
            block_hash: '0x' + 'e'.repeat(64),
            tx_hash: '0x' + 'f'.repeat(64),
            log_index: 0,
            event_type: 'ProposalCreated',
            received_at: now,
            confirmation_status: 'pending',
          })
          .execute();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);

    const daos = await pgDb.selectFrom('dao').where('slug', '=', 'smoke-dao').selectAll().execute();
    expect(daos).toHaveLength(0);
  });
});

describeWithDb('decode tracking schema (baseline migration)', () => {
  it('idx_proposal_action_pending_decode exists and filters by decode_status=pending', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        // Verify the partial index was created by the migration.
        const indexes = await trx
          .selectFrom('pg_indexes')
          .select(['indexname'])
          .where('tablename', '=', 'proposal_action')
          .where('indexname', '=', 'idx_proposal_action_pending_decode')
          .execute();
        expect(indexes).toHaveLength(1);

        // Insert minimal FK chain.
        const [dao] = await trx
          .insertInto('dao')
          .values({
            slug: `schema-smoke-dao-${Date.now()}`,
            name: 'Schema Smoke',
            primary_token_address: '0x' + 'a'.repeat(40),
            primary_chain_id: '1',
            description: 'test',
            website_url: 'https://example.com',
            forum_url: 'https://example.com',
            updated_at: new Date(),
          })
          .returning(['id'])
          .execute();

        const actorAddress = `0x${Date.now().toString(16).padStart(40, 'b').slice(0, 40)}`;
        const [actor] = await trx
          .insertInto('actor')
          .values({ primary_address: actorAddress, updated_at: new Date() })
          .returning(['id'])
          .execute();

        const now = new Date();
        const [proposal] = await trx
          .insertInto('proposal')
          .values({
            dao_id: dao!.id,
            source_type: 'compound_governor_bravo',
            source_id: `schema-smoke-${Date.now()}`,
            proposer_actor_id: actor!.id,
            description: 'test',
            description_hash: 'a'.repeat(64),
            binding: true,
            voting_starts_at: null,
            voting_ends_at: null,
            voting_starts_block: '1',
            voting_ends_block: '2',
            voting_power_block: '1',
            state: 'active',
            state_updated_at: now,
            updated_at: now,
          })
          .returning(['id'])
          .execute();

        // Insert one pending and one decoded action.
        const [pending] = await trx
          .insertInto('proposal_action')
          .values({
            proposal_id: proposal!.id,
            action_index: 0,
            target_address: '0x' + 'c'.repeat(40),
            target_chain_id: '1',
            value_wei: '0',
            calldata: '0xa9059cbb',
          })
          .returning(['id'])
          .execute();

        await trx
          .insertInto('proposal_action')
          .values({
            proposal_id: proposal!.id,
            action_index: 1,
            target_address: '0x' + 'd'.repeat(40),
            target_chain_id: '1',
            value_wei: '0',
            calldata: '0x',
            decode_status: 'decoded',
          })
          .execute();

        // A query filtered by decode_status='pending' should only return the pending row.
        const rows = await trx
          .selectFrom('proposal_action')
          .select(['id', 'decode_status'])
          .where('decode_status', '=', 'pending')
          .where('proposal_id', '=', proposal!.id)
          .execute();

        expect(rows).toHaveLength(1);
        expect(rows[0]!.id).toBe(pending!.id);
        expect(rows[0]!.decode_status).toBe('pending');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});

describeWithDb('J1 vote/delegation/address schema', () => {
  it('supports smoke inserts across vote/delegation/address tables', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        const now = new Date();
        const [dao] = await tx
          .insertInto('dao')
          .values({
            slug: `j1-smoke-dao-${Date.now()}`,
            name: 'J1 Smoke DAO',
            primary_token_address: `0x${'1'.repeat(40)}`,
            primary_chain_id: '1',
            description: 'smoke',
            website_url: 'https://example.com',
            forum_url: 'https://example.com',
            updated_at: now,
          })
          .returning(['id'])
          .execute();
        const [actorA] = await tx
          .insertInto('actor')
          .values({ primary_address: `0x${'2'.repeat(40)}`, updated_at: now })
          .returning(['id'])
          .execute();
        const [actorB] = await tx
          .insertInto('actor')
          .values({ primary_address: `0x${'3'.repeat(40)}`, updated_at: now })
          .returning(['id'])
          .execute();
        const [proposal] = await tx
          .insertInto('proposal')
          .values({
            dao_id: dao!.id,
            source_type: 'compound_governor_bravo',
            source_id: `j1-smoke-proposal-${Date.now()}`,
            proposer_actor_id: actorA!.id,
            description: 'smoke proposal',
            description_hash: 'a'.repeat(64),
            binding: true,
            voting_starts_at: null,
            voting_ends_at: null,
            voting_starts_block: '1',
            voting_ends_block: '2',
            voting_power_block: '1',
            state: 'active',
            state_updated_at: now,
            updated_at: now,
          })
          .returning(['id'])
          .execute();

        const [vote] = await tx
          .insertInto('vote')
          .values({
            proposal_id: proposal!.id,
            voter_actor_id: actorA!.id,
            voting_power_reported: '100',
            cast_at: now,
            tx_hash: `0x${'4'.repeat(64)}`,
            log_index: 1,
            primary_choice: 1,
          })
          .returning(['id'])
          .execute();
        await tx
          .insertInto('vote_choice')
          .values({ vote_id: vote!.id, choice_index: 1, weight: '1.000000000000000000' })
          .execute();
        await tx
          .insertInto('voting_power_snapshot')
          .values({
            actor_id: actorA!.id,
            dao_id: dao!.id,
            proposal_id: proposal!.id,
            block_number: '10',
            power: '100',
          })
          .execute();
        await tx
          .insertInto('delegation')
          .values({
            dao_id: dao!.id,
            delegator_actor_id: actorA!.id,
            delegate_actor_id: actorB!.id,
            voting_power: '100',
            block_number: '10',
            tx_hash: `0x${'5'.repeat(64)}`,
            event_type: 'delegate_changed',
          })
          .execute();
        await tx
          .insertInto('actor_address')
          .values({
            actor_id: actorA!.id,
            address: `0x${'6'.repeat(40)}`,
            is_primary: false,
            source: 'manual',
          })
          .execute();
        await tx
          .insertInto('actor_address_redirect')
          .values({
            from_address: `0x${'7'.repeat(40)}`,
            to_actor_id: actorA!.id,
            merged_at: now,
            merge_reason: 'smoke',
            created_by: 'test',
          })
          .execute();
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('enforces vote current-row and idempotency uniqueness', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        const now = new Date();
        const [dao] = await tx
          .insertInto('dao')
          .values({
            slug: `j1-unique-dao-${Date.now()}`,
            name: 'J1 Unique DAO',
            primary_token_address: `0x${'8'.repeat(40)}`,
            primary_chain_id: '1',
            description: 'smoke',
            website_url: 'https://example.com',
            forum_url: 'https://example.com',
            updated_at: now,
          })
          .returning(['id'])
          .execute();
        const [actor] = await tx
          .insertInto('actor')
          .values({ primary_address: `0x${'9'.repeat(40)}`, updated_at: now })
          .returning(['id'])
          .execute();
        const [actor2] = await tx
          .insertInto('actor')
          .values({ primary_address: `0x${'b'.repeat(40)}`, updated_at: now })
          .returning(['id'])
          .execute();
        const [proposal] = await tx
          .insertInto('proposal')
          .values({
            dao_id: dao!.id,
            source_type: 'compound_governor_bravo',
            source_id: `j1-unique-proposal-${Date.now()}`,
            proposer_actor_id: actor!.id,
            description: 'smoke proposal',
            description_hash: 'b'.repeat(64),
            binding: true,
            voting_starts_at: null,
            voting_ends_at: null,
            voting_starts_block: '3',
            voting_ends_block: '4',
            voting_power_block: '3',
            state: 'active',
            state_updated_at: now,
            updated_at: now,
          })
          .returning(['id'])
          .execute();

        await tx
          .insertInto('vote')
          .values({
            proposal_id: proposal!.id,
            voter_actor_id: actor!.id,
            voting_power_reported: '1',
            cast_at: now,
          })
          .execute();
        await expect(
          tx
            .insertInto('vote')
            .values({
              proposal_id: proposal!.id,
              voter_actor_id: actor!.id,
              voting_power_reported: '2',
              cast_at: now,
            })
            .execute(),
        ).rejects.toMatchObject({ code: '23505' });

        await tx
          .insertInto('vote')
          .values({
            proposal_id: proposal!.id,
            voter_actor_id: actor!.id,
            voting_power_reported: '3',
            cast_at: now,
            tx_hash: `0x${'a'.repeat(64)}`,
            log_index: 99,
          })
          .execute();
        await expect(
          tx
            .insertInto('vote')
            .values({
              proposal_id: proposal!.id,
              voter_actor_id: actor2!.id,
              voting_power_reported: '4',
              cast_at: now,
              tx_hash: `0x${'a'.repeat(64)}`,
              log_index: 99,
            })
            .execute(),
        ).rejects.toMatchObject({ code: '23505' });

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
