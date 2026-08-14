import request from 'supertest';
import {
  EMBEDDING_VERSION,
  forumSynthesisInputHash,
  mismatchInputHash,
  proposalSummaryInputHash,
} from '@libs/ai';
import { pgDb, ProposalReadRepository } from '@libs/db';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
  seedForumThread,
} from './dao-proposal-api.e2e.helpers';

// SPEC §5.2 trust-posture conformance sweep. The four AI features are individually covered by their own
// e2e specs; this consolidates the three non-negotiable §5.2 commitments — Labeling, Provenance, and
// Visibility (source content co-available) — as one invariant asserted uniformly across every AI surface
// (embedded ai_summary / ai_mismatch_flag on the proposal detail; dedicated /ai/summary, /ai/mismatch,
// /ai/forum-synthesis, /similar). Fixtures only — no paid LLM.

const PROPOSAL = '/v1/daos/compound/proposals/compound_governor_bravo/42';
const FORUM_EXTERNAL_ID = '4242';
const RAW =
  '**@alice** at 2026-05-15\n\nStrongly support lowering fees.\n\n---\n\n**@bob** raises gas.';

const SUMMARY_OUTPUT = {
  tldr: 'Raise the reserve factor.',
  proposal_type: 'parameter_change',
  proposal_type_confidence: 'high',
  affected_contracts: ['0xc3d688b66703497daa19211eedff47f25384cdc3'],
  key_changes: [{ description: 'Reserve factor 10% -> 15%', significance: 'high' }],
  funding_amount_usd: null,
};

const MISMATCH_OUTPUT = {
  overall_assessment: 'material_discrepancy',
  confidence: 'high',
  description_actions: [{ claim: 'Sets the reserve factor to 15%.', location: 'paragraph 2' }],
  calldata_actions: [
    { action_index: 0, summary: 'setReserveFactor(0.25e18)', significance: 'high' },
  ],
  discrepancies: [
    {
      type: 'value_mismatch',
      description: 'Calldata sets the reserve factor to 25%, but the description says 15%.',
      severity: 'high',
      description_excerpt: '15%',
      related_action_indices: [0],
    },
  ],
  reasoning: 'The calldata value does not match the prose.',
};

const SYNTHESIS_OUTPUT = {
  arguments_for: [{ summary: 'Lower fees benefit users', supporting_participants: ['alice'] }],
  arguments_against: [{ summary: 'Gas overhead', supporting_participants: ['bob'] }],
  unresolved_concerns: [{ summary: 'Migration path', raised_by: ['bob'] }],
  notable_participants: [{ handle: 'alice', role_summary: 'Delegate, strongly in favor' }],
  sentiment: 'mixed',
  thread_health: 'constructive',
};

async function seedAiOutput(
  featureName: string,
  inputHash: string,
  output: unknown,
  model: string,
): Promise<void> {
  await pgDb
    .insertInto('ai_output')
    .values({
      feature_name: featureName,
      prompt_version: 'v1.0',
      input_hash: inputHash,
      model,
      output,
      cost_usd: '0.005000',
      generated_at: new Date('2026-05-15T12:00:00.000Z'),
      source_provenance: {
        feature: featureName,
        model,
        promptVersion: 'v1.0',
        inputHash,
        generatedAt: '2026-05-15T12:00:00Z',
      },
    })
    .execute();
}

// Labeling + Provenance (§5.2): the `_meta` block on a completion feature identifies the model, prompt
// version, input hash, and generation time, and is labeled ai_generated: true.
function assertProvenance(meta: Record<string, unknown>): void {
  expect(meta['ai_generated']).toBe(true);
  expect(typeof meta['model']).toBe('string');
  expect((meta['model'] as string).length).toBeGreaterThan(0);
  expect(meta['prompt_version']).toBe('v1.0');
  expect(meta['input_hash']).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(typeof meta['generated_at']).toBe('string');
}

describeHttpIf('AI trust-posture sweep (SPEC §5.2)', () => {
  it('every AI surface is labeled, provenanced, and keeps source content co-available', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      await seedForumThread(seeded.daoId, seeded.proposalId, {
        rawContent: RAW,
        forumTopicId: FORUM_EXTERNAL_ID,
      });

      // Content-addressed fixtures: hash the SAME (description, actions) / raw_content the API reads back.
      const repo = new ProposalReadRepository(pgDb);
      const proposal = await repo.findOne('compound', 'compound_governor_bravo', '42');
      const actions = await repo.findActions(seeded.proposalId);
      await seedAiOutput(
        'proposal_summarizer',
        proposalSummaryInputHash(proposal!.description, actions),
        SUMMARY_OUTPUT,
        'claude-haiku-4-5',
      );
      await seedAiOutput(
        'mismatch_detector',
        mismatchInputHash(proposal!.description, actions),
        MISMATCH_OUTPUT,
        'claude-sonnet-5',
      );
      await seedAiOutput(
        'forum_synthesizer',
        forumSynthesisInputHash(RAW),
        SYNTHESIS_OUTPUT,
        'claude-haiku-4-5',
      );

      const auth = seeded.bearer;
      const get = (path: string) =>
        request(app.getHttpServer()).get(path).set('Authorization', auth);

      // ── Embedded on the proposal detail: ai_summary + ai_mismatch_flag, each with nested _meta ──
      const detail = await get(PROPOSAL).expect(200);
      assertProvenance(detail.body.data.ai_summary._meta);
      expect(detail.body.data.ai_summary.tldr).toBe('Raise the reserve factor.');
      assertProvenance(detail.body.data.ai_mismatch_flag._meta);
      expect(detail.body.data.ai_mismatch_flag.assessment).toBe('material_discrepancy');
      // Visibility (§5.2): the analyzed source rides the same response — prose + decoded calldata actions.
      expect(typeof detail.body.data.description).toBe('string');
      expect(detail.body.data.description.length).toBeGreaterThan(0);
      expect(detail.body.data.actions.length).toBeGreaterThanOrEqual(1);

      // ── Dedicated /ai/summary ──
      const summary = await get(`${PROPOSAL}/ai/summary`).expect(200);
      assertProvenance(summary.body.data._meta);
      expect(summary.body.data.tldr).toBe('Raise the reserve factor.');

      // ── Dedicated /ai/mismatch (full analysis) ──
      const mismatch = await get(`${PROPOSAL}/ai/mismatch`).expect(200);
      assertProvenance(mismatch.body.data._meta);
      expect(mismatch.body.data.overall_assessment).toBe('material_discrepancy');
      expect(mismatch.body.data.discrepancies.length).toBeGreaterThanOrEqual(1);

      // ── Dedicated /ai/forum-synthesis (envelope-level _meta) ──
      const synth = await get(`${PROPOSAL}/ai/forum-synthesis`).expect(200);
      assertProvenance(synth.body._meta);
      expect(synth.body.data.sentiment).toBe('mixed');

      // Visibility (§5.2): the synthesized source — the forum thread's raw posts — is reachable via the
      // standalone thread read, alongside the synthesis.
      const thread = await get(`/v1/daos/compound/forum/${FORUM_EXTERNAL_ID}`).expect(200);
      expect(thread.body.data.raw_content).toBe(RAW);

      // ── Dedicated /similar: labeled + version provenance even on the graceful empty-corpus path ──
      const similar = await get(`${PROPOSAL}/similar`).expect(200);
      expect(similar.body._meta.ai_generated).toBe(true);
      expect(similar.body._meta.embedding_version).toBe(EMBEDDING_VERSION);
      expect(Array.isArray(similar.body.data)).toBe(true);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('labeling holds on the non-English forum skip path (ai_generated: false + reason)', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      const zh = '这是一个完全由中文写成的治理讨论帖，没有任何英文内容。';
      await seedForumThread(seeded.daoId, seeded.proposalId, {
        rawContent: zh,
        forumTopicId: FORUM_EXTERNAL_ID,
      });
      await seedAiOutput(
        'forum_synthesizer',
        forumSynthesisInputHash(zh),
        { _meta: { skipped_reason: 'non_english' } },
        'none',
      );

      const res = await request(app.getHttpServer())
        .get(`${PROPOSAL}/ai/forum-synthesis`)
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(res.body.data).toBeNull();
      expect(res.body._meta).toEqual({ ai_generated: false, skipped_reason: 'non_english' });
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
