import { describe, expect, it, vi } from 'vitest';
import { forumSynthesisInputHash } from '@libs/ai';
import type { AiOutputRepository } from '@libs/ai';
import { ForumSynthesisReadService } from './forum-synthesis-read.service';

describe('ForumSynthesisReadService', () => {
  it('looks up ai_output by the forum_synthesizer feature, version, and raw_content hash', async () => {
    const find = vi.fn().mockResolvedValue(undefined);
    const svc = new ForumSynthesisReadService({ find } as unknown as AiOutputRepository);

    const result = await svc.findForContent('**@alice** for the proposal.');

    expect(result).toBeNull();
    expect(find).toHaveBeenCalledWith(
      'forum_synthesizer',
      'v1.0',
      forumSynthesisInputHash('**@alice** for the proposal.'),
    );
  });

  it('returns the stored ai_output row when one matches (skip marker included)', async () => {
    const row = {
      output: { _meta: { skipped_reason: 'non_english' } },
      model: 'none',
      prompt_version: 'v1.0',
      input_hash: 'sha256:abc',
      generated_at: new Date('2026-04-12T08:30:00Z'),
    };
    const find = vi.fn().mockResolvedValue(row);
    const svc = new ForumSynthesisReadService({ find } as unknown as AiOutputRepository);

    expect(await svc.findForContent('内容')).toBe(row);
  });
});
