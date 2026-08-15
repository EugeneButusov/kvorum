import { createHmac } from 'node:crypto';

const TEST_PEPPER = Buffer.alloc(32, 7);
const TEST_BEARER_KEY = `${'kv_live_'}${'a'.repeat(32)}`;

function hashApiKey(pepper: Buffer, key: string): Buffer {
  return createHmac('sha256', pepper).update(key, 'utf8').digest();
}

const PROPOSAL_STATES = [
  'pending',
  'active',
  'succeeded',
  'defeated',
  'queued',
  'executed',
  'canceled',
  'expired',
  'vetoed',
] as const;

function ts(base: Date, offsetMinutes: number): Date {
  return new Date(base.getTime() + offsetMinutes * 60_000);
}

async function main(): Promise<void> {
  process.env['DATABASE_URL'] ??= 'postgresql://kvorum:kvorum@localhost:5432/kvorum';
  const { pgDb } = await import('../src/client');
  dbRef = pgDb;
  await pgDb.deleteFrom('ai_output').execute();
  await pgDb.deleteFrom('proposal_choice').execute();
  await pgDb.deleteFrom('proposal_action').execute();
  await pgDb.deleteFrom('proposal').execute();
  await pgDb.deleteFrom('dao_source').execute();
  await pgDb.deleteFrom('actor').execute();
  await pgDb.deleteFrom('dao').execute();
  await pgDb.deleteFrom('api_key').execute();
  await pgDb.deleteFrom('users').execute();

  await pgDb
    .insertInto('source_type')
    .values([{ value: 'compound_governor' }])
    .onConflict((oc) => oc.column('value').doNothing())
    .execute();

  const base = new Date('2026-05-15T00:00:00.000Z');

  await pgDb
    .insertInto('users')
    .values({
      id: '00000000-0000-0000-0000-000000100001',
      email: 'loadtest@example.com',
      display_name: 'Load Test User',
      role: 'admin',
      banned_at: null,
      banned_reason: null,
      created_at: ts(base, 0),
      updated_at: ts(base, 0),
    })
    .execute();

  await pgDb
    .insertInto('api_key')
    .values({
      id: '00000000-0000-0000-0000-000000100002',
      user_id: '00000000-0000-0000-0000-000000100001',
      key_hash: hashApiKey(TEST_PEPPER, TEST_BEARER_KEY),
      prefix: 'kv_live_',
      last_four: 'aaaa',
      tier: 'authenticated_free',
      label: 'loadtest',
      last_used_at: null,
      revoked_at: null,
      created_at: ts(base, 1),
    })
    .execute();

  await pgDb
    .insertInto('dao')
    .values({
      id: '00000000-0000-0000-0000-000000100010',
      slug: 'compound',
      name: 'Compound',
      primary_token_address: `0x${'c'.repeat(40)}`,
      primary_chain_id: '1',
      description: 'Compound DAO',
      website_url: 'https://compound.finance',
      forum_url: 'https://www.comp.xyz',
      created_at: ts(base, 2),
      updated_at: ts(base, 2),
    })
    .execute();

  await pgDb
    .insertInto('dao_source')
    .values({
      id: '00000000-0000-0000-0000-000000100011',
      dao_id: '00000000-0000-0000-0000-000000100010',
      source_type: 'compound_governor',
      chain_id: '0x1',
      source_config: {
        contract_address: `0x${'d'.repeat(40)}`,
        chain_id: '0x1',
      },
      active_from_block: null,
      active_to_block: null,
      backfill_started_at_block: null,
      backfill_head_block: null,
      created_at: ts(base, 3),
    })
    .execute();

  const actors = Array.from({ length: 20 }).map((_, i) => ({
    id: `00000000-0000-0000-0000-${String(100100 + i).padStart(12, '0')}`,
    primary_address: `0x${String(i.toString(16)).padStart(40, 'a')}`,
    display_name: i % 3 === 0 ? `Actor ${i}` : null,
    bio: null,
    profile_data: null,
    created_at: ts(base, 10 + i),
    updated_at: ts(base, 10 + i),
  }));

  await pgDb.insertInto('actor').values(actors).execute();

  const proposals = Array.from({ length: 300 }).map((_, i) => {
    const created = ts(base, 100 + i);
    const stateUpdated = ts(base, 100 + i + 1);
    const hasNullWindow = i % 4 === 0;

    return {
      id: `00000000-0000-0000-0000-${String(200000 + i).padStart(12, '0')}`,
      dao_id: '00000000-0000-0000-0000-000000100010',
      source_type: 'compound_governor' as const,
      source_id: String(10_000 + i),
      proposer_actor_id: actors[i % actors.length]!.id,
      title: i % 7 === 0 ? null : `Load proposal ${i}`,
      description: `Synthetic load proposal ${i}`,
      description_hash: `0x${(i + 1).toString(16).padStart(64, '0')}`,
      binding: i % 2 === 0,
      voting_starts_at: hasNullWindow ? null : ts(created, 5),
      voting_ends_at: hasNullWindow ? null : ts(created, 120),
      voting_starts_block: hasNullWindow ? null : String(19_850_000 + i),
      voting_ends_block: hasNullWindow ? null : String(19_850_500 + i),
      state: PROPOSAL_STATES[i % PROPOSAL_STATES.length]!,
      state_updated_at: stateUpdated,
      created_at: created,
      updated_at: stateUpdated,
    };
  });

  await pgDb.insertInto('proposal').values(proposals).execute();

  const actions = proposals.flatMap((proposal, i) => {
    const count = (i % 5) + 1;
    return Array.from({ length: count }).map((_, actionIndex) => ({
      id: `00000000-0000-0000-0000-${String(300000 + i * 5 + actionIndex).padStart(12, '0')}`,
      proposal_id: proposal.id,
      action_index: actionIndex,
      target_address: `0x${String((i + actionIndex).toString(16)).padStart(40, 'b')}`,
      target_chain_id: '1',
      value_wei: String(actionIndex),
      function_signature: actionIndex % 2 === 0 ? 'set(uint256)' : null,
      calldata: `0x${(i + actionIndex).toString(16)}`,
      decoded_function: actionIndex % 2 === 0 ? 'set' : null,
      decoded_arguments: actionIndex % 2 === 0 ? { value: String(i + actionIndex) } : null,
      created_at: ts(base, 200 + i + actionIndex),
    }));
  });

  await pgDb.insertInto('proposal_action').values(actions).execute();

  const choices = proposals.flatMap((proposal) => [
    { proposal_id: proposal.id, choice_index: 0, value: 'Against' },
    { proposal_id: proposal.id, choice_index: 1, value: 'For' },
    { proposal_id: proposal.id, choice_index: 2, value: 'Abstain' },
  ]);

  await pgDb.insertInto('proposal_choice').values(choices).execute();

  // #450 / SPEC §7.2: seed AI output for the perf-gate detail target (proposal i=10 → source_id 10010,
  // binding) so the gated read (`.../proposals/compound_governor/10010`) exercises the POPULATED
  // ai_output path — the full-payload materialization + JSON serialization — not the empty miss path.
  // Content-addressed by the same (description, actions) the API recomputes; reuse the shared hashers
  // (relative imports — tsx does not resolve the @libs/* aliases) so the input_hash can never drift.
  const { ProposalReadRepository } = await import('../src/proposal-read-repository');
  const { proposalSummaryInputHash } = await import(
    '../../ai/src/schemas/proposal-summary-input.js'
  );
  const { mismatchInputHash } = await import('../../ai/src/schemas/mismatch-input.js');
  const readRepo = new ProposalReadRepository(pgDb);
  const target = await readRepo.findOne('compound', 'compound_governor', '10010');
  if (target === undefined) {
    throw new Error('load-test seed: perf-gate detail target proposal 10010 was not seeded');
  }
  const targetActions = await readRepo.findActions(target.id);
  const aiGeneratedAt = ts(base, 500);
  await pgDb
    .insertInto('ai_output')
    .values([
      {
        feature_name: 'proposal_summarizer',
        prompt_version: 'v1.0',
        input_hash: proposalSummaryInputHash(target.description, targetActions),
        model: 'claude-haiku-4-5',
        output: {
          tldr: 'Adjust a protocol parameter for the synthetic load-test proposal.',
          proposal_type: 'parameter_change',
          proposal_type_confidence: 'high',
          affected_contracts: [`0x${'b'.repeat(40)}`],
          key_changes: [{ description: 'Set a value', significance: 'medium' }],
          funding_amount_usd: null,
        },
        cost_usd: '0.002000',
        generated_at: aiGeneratedAt,
        source_provenance: {
          feature: 'proposal_summarizer',
          model: 'claude-haiku-4-5',
          promptVersion: 'v1.0',
          inputHash: proposalSummaryInputHash(target.description, targetActions),
          generatedAt: aiGeneratedAt.toISOString(),
        },
      },
      {
        feature_name: 'mismatch_detector',
        prompt_version: 'v1.0',
        input_hash: mismatchInputHash(target.description, targetActions),
        model: 'claude-sonnet-5',
        output: {
          overall_assessment: 'material_discrepancy',
          confidence: 'high',
          description_actions: [{ claim: 'Sets a value', location: 'body' }],
          calldata_actions: [{ action_index: 0, summary: 'set(...)', significance: 'high' }],
          discrepancies: [
            {
              type: 'value_mismatch',
              description: 'The calldata value differs from the prose.',
              severity: 'high',
              description_excerpt: null,
              related_action_indices: [0],
            },
          ],
          reasoning: 'Synthetic mismatch for the load-test detail target.',
        },
        cost_usd: '0.010000',
        generated_at: aiGeneratedAt,
        source_provenance: {
          feature: 'mismatch_detector',
          model: 'claude-sonnet-5',
          promptVersion: 'v1.0',
          inputHash: mismatchInputHash(target.description, targetActions),
          generatedAt: aiGeneratedAt.toISOString(),
        },
      },
    ])
    .execute();

  console.log('Seeded load-test dataset:', {
    dao: 'compound',
    actors: actors.length,
    proposals: proposals.length,
    actions: actions.length,
    choices: choices.length,
    ai_output: 2, // summary + mismatch on the perf-gate detail target (10010)
    bearer: `Bearer ${TEST_BEARER_KEY}`,
  });
}

let dbRef: Awaited<ReturnType<typeof import('../src/client')>>['pgDb'] | undefined;

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dbRef !== undefined) {
      await dbRef.destroy();
    }
  });
