import { sql } from 'kysely';
import { chDb, pgDb } from './client';

// Sentinel thrown inside transaction to trigger intentional rollback.
class RollbackSignal extends Error {}

// These tests require a running Postgres instance (DATABASE_URL env var).
// They are skipped when DATABASE_URL is not set so the suite passes in
// environments without a DB (e.g. pure typecheck CI steps).
const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

// Cross-DB tests additionally require ClickHouse to be reachable. Gate on
// CLICKHOUSE_URL being explicitly set so the test only runs in environments
// where both DBs are provisioned (local docker-compose + CI db job).
const describeWithBothDbs =
  process.env['DATABASE_URL'] != null && process.env['CLICKHOUSE_URL'] != null
    ? describe
    : describe.skip;

// Single teardown shared across all suites — pgDb is a module-level singleton.
afterAll(async () => {
  await Promise.all([pgDb.destroy(), chDb.destroy()]);
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
            source_type: 'compound_governor',
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
            source_type: 'compound_governor',
            source_id: 'smoke-1',
            proposer_actor_id: actor!.id,
            description: 'smoke proposal',
            description_hash: 'a'.repeat(64),
            binding: true,
            voting_starts_at: now,
            voting_ends_at: now,
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
            source_type: 'compound_governor',
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

describeWithBothDbs('cross-DB ADR-041 smoke test', () => {
  it('follows PG-first existence check → CH insert → PG insert protocol', async () => {
    // Fixed tuple for this smoke run — unique enough to not collide with real data.
    const tuple = {
      source_type: 'compound_governor' as const,
      chain_id: '0x7a69',
      // FixedString(66) = "0x" + 64 hex chars
      tx_hash: '0x' + '1'.repeat(64),
      log_index: 0,
      block_hash: '0x' + '2'.repeat(64),
      block_number: '99999999',
      dao_source_id: '00000000-0000-0000-0000-000000000001',
    };

    // Step 1: PG existence check — must return no rows before we write.
    const existing = await pgDb
      .selectFrom('archive_confirmation')
      .where('source_type', '=', tuple.source_type)
      .where('chain_id', '=', tuple.chain_id)
      .where('tx_hash', '=', tuple.tx_hash)
      .where('log_index', '=', tuple.log_index)
      .where('block_hash', '=', tuple.block_hash)
      .selectAll()
      .execute();
    expect(existing).toHaveLength(0);

    // Step 2: CH insert (idempotent via ReplacingMergeTree).
    await chDb
      .insertInto('event_archive_compound_governor')
      .values({
        dao_source_id: tuple.dao_source_id,
        chain_id: tuple.chain_id,
        block_number: tuple.block_number,
        block_hash: tuple.block_hash,
        tx_hash: tuple.tx_hash,
        log_index: tuple.log_index,
        event_type: 'ProposalCreated',
        received_at: new Date(),
        payload: JSON.stringify({ smoke: true }),
      })
      .execute();

    // Inserting the same row again must be idempotent (ReplacingMergeTree dedup).
    await chDb
      .insertInto('event_archive_compound_governor')
      .values({
        dao_source_id: tuple.dao_source_id,
        chain_id: tuple.chain_id,
        block_number: tuple.block_number,
        block_hash: tuple.block_hash,
        tx_hash: tuple.tx_hash,
        log_index: tuple.log_index,
        event_type: 'ProposalCreated',
        received_at: new Date(),
        payload: JSON.stringify({ smoke: true }),
      })
      .execute();

    // Query back with FINAL to force dedup — ReplacingMergeTree deduplicates during
    // background merges, not on insert, so without FINAL the two idempotent inserts
    // above may both still be visible. The ClickHouse dialect's executeQuery only
    // returns rows for SelectQueryNode; sql`...`.execute() falls through to command()
    // which always returns rows:[]. Use a builder selectFrom with a raw table expression
    // so the query stays a SelectQueryNode while FINAL is inlined into the FROM clause.
    const chRows = await chDb
      .selectFrom(sql<'event_archive_compound_governor'>`event_archive_compound_governor FINAL`)
      .select(['tx_hash'])
      .where('chain_id', '=', tuple.chain_id)
      .where('tx_hash', '=', tuple.tx_hash)
      .where('log_index', '=', tuple.log_index)
      .where('block_hash', '=', tuple.block_hash)
      .execute();
    expect(chRows).toHaveLength(1);

    // Cleanup — lightweight delete mutation.
    await sql`
      ALTER TABLE event_archive_compound_governor
      DELETE WHERE tx_hash = ${tuple.tx_hash}
    `.execute(chDb);
  });
});
