import request from 'supertest';
import { mismatchInputHash } from '@libs/ai';
import { pgDb, ProposalReadRepository } from '@libs/db';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

function mismatchAnalysis(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

// Seed a mismatch ai_output row whose input_hash is derived from the SAME (description, actions) the API
// reads back — proving the content-addressed lookup matches end-to-end (the load-bearing contract).
async function seedMismatchFor(
  proposalId: string,
  output: Record<string, unknown>,
): Promise<string> {
  const repo = new ProposalReadRepository(pgDb);
  const proposal = await repo.findOne('compound', 'compound_governor_bravo', '42');
  const actions = await repo.findActions(proposalId);
  const inputHash = mismatchInputHash(proposal!.description, actions);
  await pgDb
    .insertInto('ai_output')
    .values({
      feature_name: 'mismatch_detector',
      prompt_version: 'v1.0',
      input_hash: inputHash,
      model: 'claude-sonnet-5',
      output,
      cost_usd: '0.010000',
      generated_at: new Date('2026-04-12T08:30:00.000Z'),
      source_provenance: {
        feature: 'mismatch_detector',
        model: 'claude-sonnet-5',
        promptVersion: 'v1.0',
        inputHash,
        generatedAt: '2026-04-12T08:30:00Z',
      },
    })
    .execute();
  return inputHash;
}

describeHttpIf('proposal ai_mismatch_flag e2e', () => {
  it('embeds ai_mismatch_flag with provenance _meta and co-available source content', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      const inputHash = await seedMismatchFor(seeded.proposalId, mismatchAnalysis());

      const detail = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42')
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(detail.body.data.ai_mismatch_flag).toEqual({
        assessment: 'material_discrepancy',
        summary: 'Calldata sets the reserve factor to 25%, but the description says 15%.',
        _meta: {
          ai_generated: true,
          model: 'claude-sonnet-5',
          prompt_version: 'v1.0',
          input_hash: inputHash,
          generated_at: '2026-04-12T08:30:00Z',
        },
      });
      // Trust posture (SPEC §5.2): the analyzed source content is co-available on the same response —
      // the prose description and the decoded calldata actions the analysis compared.
      expect(detail.body.data.description).toBe('Proposal body');
      expect(detail.body.data.actions).toHaveLength(1);
      // The summary embed rides the same response; assert both AI fields are exercised together.
      expect(detail.body.data).toHaveProperty('ai_summary');
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('suppresses the flag (null) when the stored analysis is consistent', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      await seedMismatchFor(
        seeded.proposalId,
        mismatchAnalysis({ overall_assessment: 'consistent', discrepancies: [] }),
      );

      const detail = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42')
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(detail.body.data.ai_mismatch_flag).toBeNull();
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('returns null ai_mismatch_flag when no analysis exists', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData(); // no ai_output seeded

      const detail = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42')
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(detail.body.data.ai_mismatch_flag).toBeNull();
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  const MISMATCH_ENDPOINT = '/v1/daos/compound/proposals/compound_governor_bravo/42/ai/mismatch';

  it('dedicated /ai/mismatch returns the full analysis + provenance for a material discrepancy', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      const inputHash = await seedMismatchFor(seeded.proposalId, mismatchAnalysis());

      const res = await request(app.getHttpServer())
        .get(MISMATCH_ENDPOINT)
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(res.body.data.overall_assessment).toBe('material_discrepancy');
      expect(res.body.data.confidence).toBe('high');
      expect(res.body.data.discrepancies).toHaveLength(1);
      expect(res.body.data.reasoning).toBe('The calldata value does not match the prose.');
      expect(res.body.data._meta).toEqual({
        ai_generated: true,
        model: 'claude-sonnet-5',
        prompt_version: 'v1.0',
        input_hash: inputHash,
        generated_at: '2026-04-12T08:30:00Z',
      });
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('dedicated /ai/mismatch returns a consistent analysis (retrievable though it surfaces no flag)', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      await seedMismatchFor(
        seeded.proposalId,
        mismatchAnalysis({ overall_assessment: 'consistent', discrepancies: [] }),
      );

      // The embedded flag is suppressed for `consistent`, but the dedicated endpoint still returns it.
      const detail = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42')
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(detail.body.data.ai_mismatch_flag).toBeNull();

      const res = await request(app.getHttpServer())
        .get(MISMATCH_ENDPOINT)
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(res.body.data.overall_assessment).toBe('consistent');
      expect(res.body.data.discrepancies).toEqual([]);
      expect(res.body.data._meta.ai_generated).toBe(true);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('dedicated /ai/mismatch 404s when no analysis exists', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData(); // no ai_output seeded

      await request(app.getHttpServer())
        .get(MISMATCH_ENDPOINT)
        .set('Authorization', seeded.bearer)
        .expect(404);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
