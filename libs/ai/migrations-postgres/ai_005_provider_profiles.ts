import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('ai_output')
    .addColumn('provider', 'text', (col) => col.notNull().defaultTo('anthropic'))
    .addColumn('generation_profile_id', 'text', (col) =>
      col.notNull().defaultTo('anthropic-fast-v1'),
    )
    .execute();
  await sql`
    update ai_output
    set generation_profile_id = case
      when model = 'claude-sonnet-5' then 'anthropic-strong-v1'
      when model = 'none' then 'internal-forum-skip-v1'
      else 'anthropic-fast-v1'
    end,
    provider = case when model = 'none' then 'internal' else 'anthropic' end
  `.execute(db);
  await sql`alter table ai_output drop constraint ai_output_key_uq`.execute(db);
  await db.schema
    .alterTable('ai_output')
    .addUniqueConstraint('ai_output_profile_key_uq', [
      'feature_name',
      'prompt_version',
      'input_hash',
      'generation_profile_id',
    ])
    .execute();

  await db.schema
    .alterTable('ai_cost_log')
    .addColumn('provider', 'text', (col) => col.notNull().defaultTo('anthropic'))
    .addColumn('generation_profile_id', 'text', (col) =>
      col.notNull().defaultTo('anthropic-fast-v1'),
    )
    .execute();
  await sql`
    update ai_cost_log
    set generation_profile_id = case
      when model = 'claude-sonnet-5' then 'anthropic-strong-v1'
      when model = 'none' then 'internal-forum-skip-v1'
      else 'anthropic-fast-v1'
    end,
    provider = case when model = 'none' then 'internal' else 'anthropic' end
  `.execute(db);

  await db.schema
    .alterTable('ai_dlq')
    .addColumn('provider', 'text', (col) => col.notNull().defaultTo('anthropic'))
    .addColumn('generation_profile_id', 'text', (col) =>
      col.notNull().defaultTo('anthropic-fast-v1'),
    )
    .execute();
  await sql`
    update ai_dlq
    set generation_profile_id = case
      when model = 'claude-sonnet-5' then 'anthropic-strong-v1'
      else 'anthropic-fast-v1'
    end
  `.execute(db);
  await sql`alter table ai_dlq drop constraint ai_dlq_key_uq`.execute(db);
  await db.schema
    .alterTable('ai_dlq')
    .addUniqueConstraint('ai_dlq_profile_key_uq', [
      'feature_name',
      'prompt_version',
      'input_hash',
      'generation_profile_id',
    ])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Adding the legacy keys first makes downgrade fail safely if multiple provider outputs coexist.
  await db.schema
    .alterTable('ai_output')
    .addUniqueConstraint('ai_output_key_uq', ['feature_name', 'prompt_version', 'input_hash'])
    .execute();
  await sql`alter table ai_output drop constraint ai_output_profile_key_uq`.execute(db);
  await db.schema
    .alterTable('ai_output')
    .dropColumn('generation_profile_id')
    .dropColumn('provider')
    .execute();

  await db.schema
    .alterTable('ai_cost_log')
    .dropColumn('generation_profile_id')
    .dropColumn('provider')
    .execute();

  await db.schema
    .alterTable('ai_dlq')
    .addUniqueConstraint('ai_dlq_key_uq', ['feature_name', 'prompt_version', 'input_hash'])
    .execute();
  await sql`alter table ai_dlq drop constraint ai_dlq_profile_key_uq`.execute(db);
  await db.schema
    .alterTable('ai_dlq')
    .dropColumn('generation_profile_id')
    .dropColumn('provider')
    .execute();
}
