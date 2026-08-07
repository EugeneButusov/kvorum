import request from 'supertest';
import { forumSynthesisInputHash } from '@libs/ai';
import { pgDb } from '@libs/db';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
  seedForumThread,
} from './dao-proposal-api.e2e.helpers';

const ENDPOINT = '/v1/daos/compound/proposals/compound_governor_bravo/42/ai/forum-synthesis';

const RAW =
  '**@alice** at 2026-05-15\n\nStrongly support lowering fees.\n\n---\n\n**@bob** raises gas concerns.';

const SYNTHESIS_OUTPUT = {
  arguments_for: [{ summary: 'Lower fees benefit users', supporting_participants: ['alice'] }],
  arguments_against: [{ summary: 'Gas overhead', supporting_participants: ['bob'] }],
  unresolved_concerns: [{ summary: 'Migration path', raised_by: ['bob'] }],
  notable_participants: [{ handle: 'alice', role_summary: 'Delegate, strongly in favor' }],
  sentiment: 'mixed',
  thread_health: 'constructive',
};

// Seed a forum-synthesis ai_output row whose input_hash is derived from the SAME raw_content the
// endpoint reads back off the linked thread — proving the content-addressed lookup matches end-to-end.
async function seedSynthesisFor(
  rawContent: string,
  opts: { skip?: boolean } = {},
): Promise<string> {
  const inputHash = forumSynthesisInputHash(rawContent);
  const model = opts.skip ? 'none' : 'claude-haiku-4-5';
  await pgDb
    .insertInto('ai_output')
    .values({
      feature_name: 'forum_synthesizer',
      prompt_version: 'v1.0',
      input_hash: inputHash,
      model,
      output: opts.skip ? { _meta: { skipped_reason: 'non_english' } } : SYNTHESIS_OUTPUT,
      cost_usd: opts.skip ? '0.000000' : '0.005000',
      generated_at: new Date('2026-05-15T12:00:00.000Z'),
      source_provenance: {
        feature: 'forum_synthesizer',
        model,
        promptVersion: 'v1.0',
        inputHash,
        generatedAt: '2026-05-15T12:00:00Z',
      },
    })
    .execute();
  return inputHash;
}

describeHttpIf('proposal forum-synthesis e2e', () => {
  it('serves the structured synthesis with provenance _meta (SPEC §5.7)', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      await seedForumThread(seeded.daoId, seeded.proposalId, { rawContent: RAW });
      await seedSynthesisFor(RAW);

      const res = await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(res.body.data.sentiment).toBe('mixed');
      expect(res.body.data.thread_health).toBe('constructive');
      expect(res.body.data.arguments_for[0].summary).toBe('Lower fees benefit users');
      expect(res.body.data.notable_participants[0].handle).toBe('alice');
      expect(res.body._meta).toEqual({
        ai_generated: true,
        model: 'claude-haiku-4-5',
        prompt_version: 'v1.0',
        input_hash: forumSynthesisInputHash(RAW),
        generated_at: '2026-05-15T12:00:00Z',
      });
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('returns data:null with skipped_reason for a non-English thread (KNOWN-016)', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      const zh = '这是一个完全由中文写成的治理讨论帖，没有任何英文内容。';
      await seedForumThread(seeded.daoId, seeded.proposalId, { rawContent: zh });
      await seedSynthesisFor(zh, { skip: true });

      const res = await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body._meta).toEqual({ ai_generated: false, skipped_reason: 'non_english' });
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('404s when the linked thread has no synthesis yet', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();
      await seedForumThread(seeded.daoId, seeded.proposalId, { rawContent: RAW }); // no synthesis

      await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', seeded.bearer)
        .expect(404);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('404s when the proposal has no linked forum thread', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData(); // no forum thread

      await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', seeded.bearer)
        .expect(404);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('404s when the proposal does not resolve', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();

      await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/999/ai/forum-synthesis')
        .set('Authorization', seeded.bearer)
        .expect(404);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
