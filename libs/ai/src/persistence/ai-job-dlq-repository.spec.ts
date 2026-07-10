import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { AiJobDlqRepository } from './ai-job-dlq-repository.js';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

describeWithDb('AiJobDlqRepository', () => {
  const repo = new AiJobDlqRepository(pgDb);

  beforeEach(async () => {
    await pgDb.deleteFrom('ai_job_dlq').execute();
  });

  afterAll(async () => {
    await pgDb.deleteFrom('ai_job_dlq').execute();
    await pgDb.destroy();
  });

  it('inserts a row, then upserts one row (bumps last_seen_at/attempts, preserves first_seen_at)', async () => {
    const first = new Date('2026-07-11T00:00:00Z');
    const later = new Date('2026-07-11T01:00:00Z');

    await repo.insert({
      feature: 'proposal_summarizer',
      entity_ref: 'proposal:p1',
      input_hash: null,
      payload: { feature: 'proposal_summarizer', entityRef: 'proposal:p1' },
      error: { name: 'DeadLettered', message: 'job a exhausted retries' },
      attempts: 1,
      first_seen_at: first,
      last_seen_at: first,
    });
    await repo.insert({
      feature: 'proposal_summarizer',
      entity_ref: 'proposal:p1',
      input_hash: 'sha256:abc',
      payload: { feature: 'proposal_summarizer', entityRef: 'proposal:p1' },
      error: { name: 'DeadLettered', message: 'job b exhausted retries' },
      attempts: 2,
      first_seen_at: later, // must NOT overwrite the stored first_seen_at
      last_seen_at: later,
    });

    const rows = await pgDb.selectFrom('ai_job_dlq').selectAll().execute();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error('expected one ai_job_dlq row');
    expect(row.attempts).toBe(2);
    expect(row.input_hash).toBe('sha256:abc');
    expect(new Date(row.first_seen_at).toISOString()).toBe(first.toISOString());
    expect(new Date(row.last_seen_at).toISOString()).toBe(later.toISOString());
  });
});
