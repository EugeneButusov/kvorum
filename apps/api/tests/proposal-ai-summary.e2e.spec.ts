import request from 'supertest';
import { proposalSummaryInputHash } from '@libs/ai';
import { pgDb, ProposalReadRepository } from '@libs/db';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

const SUMMARY_OUTPUT = {
  tldr: 'Raise the reserve factor.',
  proposal_type: 'parameter_change',
  proposal_type_confidence: 'high',
  affected_contracts: ['0xc3d688b66703497daa19211eedff47f25384cdc3'],
  key_changes: [{ description: 'Reserve factor 10% -> 15%', significance: 'high' }],
  funding_amount_usd: null,
};

// Seed an ai_output row whose input_hash is derived from the SAME (description, actions) the API
// reads back — proving the content-addressed lookup matches end-to-end (the load-bearing contract).
async function seedSummaryFor(proposalId: string): Promise<string> {
  const repo = new ProposalReadRepository(pgDb);
  const proposal = await repo.findOne('compound', 'compound_governor_bravo', '42');
  const actions = await repo.findActions(proposalId);
  const inputHash = proposalSummaryInputHash(proposal!.description, actions);
  await pgDb
    .insertInto('ai_output')
    .values({
      feature_name: 'proposal_summarizer',
      prompt_version: 'v1.0',
      input_hash: inputHash,
      model: 'claude-haiku-4-5-20251001',
      output: SUMMARY_OUTPUT,
      cost_usd: '0.002000',
      generated_at: new Date('2026-04-12T08:30:00.000Z'),
      source_provenance: {
        feature: 'proposal_summarizer',
        model: 'claude-haiku-4-5-20251001',
        promptVersion: 'v1.0',
        inputHash,
        generatedAt: '2026-04-12T08:30:00Z',
      },
    })
    .execute();
  return inputHash;
}

describeHttpIf('proposal ai_summary e2e', () => {
  it('embeds ai_summary with provenance _meta and serves the dedicated endpoint', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      const inputHash = await seedSummaryFor(seeded.proposalId);

      const detail = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42')
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(detail.body.data.ai_summary.tldr).toBe('Raise the reserve factor.');
      expect(detail.body.data.ai_summary._meta).toEqual({
        ai_generated: true,
        model: 'claude-haiku-4-5-20251001',
        prompt_version: 'v1.0',
        input_hash: inputHash,
        generated_at: '2026-04-12T08:30:00Z',
      });

      const dedicated = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42/ai/summary')
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(dedicated.body.data.tldr).toBe('Raise the reserve factor.');
      expect(dedicated.body.data._meta.ai_generated).toBe(true);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('returns null ai_summary and 404s the dedicated endpoint when no summary exists', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData(); // no ai_output seeded

      const detail = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42')
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(detail.body.data.ai_summary).toBeNull();

      await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42/ai/summary')
        .set('Authorization', seeded.bearer)
        .expect(404);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
