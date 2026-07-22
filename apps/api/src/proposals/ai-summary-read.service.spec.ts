import { describe, expect, it, vi } from 'vitest';
import { proposalSummaryInputHash } from '@libs/ai';
import type { AiOutputRepository } from '@libs/ai';
import { AiSummaryReadService } from './ai-summary-read.service';

describe('AiSummaryReadService', () => {
  it('looks up ai_output by the proposal_summarizer feature, version, and content hash', async () => {
    const find = vi.fn().mockResolvedValue(undefined);
    const svc = new AiSummaryReadService({ find } as unknown as AiOutputRepository);

    const result = await svc.findForProposal('Raise the reserve factor.', []);

    expect(result).toBeNull();
    expect(find).toHaveBeenCalledWith(
      'proposal_summarizer',
      'v1.0',
      proposalSummaryInputHash('Raise the reserve factor.', []),
    );
  });

  it('returns the stored ai_output row when one matches', async () => {
    const row = {
      output: { tldr: 'ok' },
      model: 'claude-haiku-4-5',
      prompt_version: 'v1.0',
      input_hash: 'sha256:abc',
      generated_at: new Date('2026-04-12T08:30:00Z'),
    };
    const find = vi.fn().mockResolvedValue(row);
    const svc = new AiSummaryReadService({ find } as unknown as AiOutputRepository);

    expect(await svc.findForProposal('body', [])).toBe(row);
  });
});
