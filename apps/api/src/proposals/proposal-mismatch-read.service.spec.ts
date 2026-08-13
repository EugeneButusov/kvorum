import { describe, expect, it, vi } from 'vitest';
import { mismatchInputHash } from '@libs/ai';
import type { AiOutputRepository } from '@libs/ai';
import { ProposalMismatchReadService } from './proposal-mismatch-read.service';

describe('ProposalMismatchReadService', () => {
  it('looks up ai_output by the mismatch_detector feature, version, and content hash', async () => {
    const find = vi.fn().mockResolvedValue(undefined);
    const svc = new ProposalMismatchReadService({ find } as unknown as AiOutputRepository);

    const result = await svc.findForProposal('Raise the reserve factor.', []);

    expect(result).toBeNull();
    expect(find).toHaveBeenCalledWith(
      'mismatch_detector',
      'v1.0',
      mismatchInputHash('Raise the reserve factor.', []),
    );
  });

  it('returns the stored ai_output row when one matches', async () => {
    const row = {
      output: { overall_assessment: 'consistent', confidence: 'high', discrepancies: [] },
      model: 'claude-sonnet-5',
      prompt_version: 'v1.0',
      input_hash: 'sha256:abc',
      generated_at: new Date('2026-04-12T08:30:00Z'),
    };
    const find = vi.fn().mockResolvedValue(row);
    const svc = new ProposalMismatchReadService({ find } as unknown as AiOutputRepository);

    expect(await svc.findForProposal('body', [])).toBe(row);
  });
});
