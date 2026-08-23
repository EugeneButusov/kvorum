import type { AiOutput } from '@libs/ai';
import { toForumSynthesisResponse } from './forum-synthesis.mapper';

describe('toForumSynthesisResponse', () => {
  const base = {
    feature_name: 'forum_synthesizer',
    prompt_version: 'v1.0',
    input_hash: 'sha256:def',
    cost_usd: '0.005000',
    generated_at: new Date('2026-04-12T08:30:00.500Z'),
    source_provenance: {},
  };

  it('maps a real synthesis with provenance _meta at the envelope level', () => {
    const output = {
      ...base,
      model: 'claude-sonnet-5',
      output: {
        arguments_for: [{ summary: 'Lower fees', supporting_participants: ['alice'] }],
        arguments_against: [],
        unresolved_concerns: [],
        notable_participants: [{ handle: 'alice', role_summary: 'delegate' }],
        sentiment: 'favorable',
        thread_health: 'constructive',
      },
    } as unknown as AiOutput;

    const res = toForumSynthesisResponse(output);
    expect(res.data?.sentiment).toBe('favorable');
    expect(res.data?.arguments_for[0]?.supporting_participants).toEqual(['alice']);
    expect(res._meta).toEqual({
      ai_generated: true,
      model: 'claude-sonnet-5',
      prompt_version: 'v1.0',
      input_hash: 'sha256:def',
      generated_at: '2026-04-12T08:30:00Z',
    });
  });

  it('maps a non-English skip marker to data:null + skipped_reason', () => {
    const output = {
      ...base,
      model: 'none',
      output: { _meta: { skipped_reason: 'non_english' } },
    } as unknown as AiOutput;

    const res = toForumSynthesisResponse(output);
    expect(res.data).toBeNull();
    expect(res._meta).toEqual({ ai_generated: false, skipped_reason: 'non_english' });
  });
});
