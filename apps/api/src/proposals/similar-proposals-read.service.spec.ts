import { describe, expect, it, vi } from 'vitest';
import type { SimilarProposal } from '@libs/ai';
import { SimilarProposalsReadService } from './similar-proposals-read.service';

function row(over: Partial<SimilarProposal> = {}): SimilarProposal {
  return {
    dao_slug: 'compound',
    dao_name: 'Compound',
    source_type: 'compound_governor_bravo',
    source_id: '42',
    title: 'Raise reserve factor',
    state: 'active',
    created_at: new Date('2026-01-02T03:04:05.678Z'),
    voting_starts_at: new Date('2026-01-03T00:00:00Z'),
    voting_ends_at: null,
    similarity: 0.87,
    ...over,
  } as SimilarProposal;
}

describe('SimilarProposalsReadService', () => {
  it('forwards filters and maps rows to DTOs with ISO-second dates', async () => {
    const findSimilar = vi.fn(async () => [row()]);
    const svc = new SimilarProposalsReadService({ findSimilar } as never);

    const out = await svc.findSimilar('p1', { dao: 'compound', limit: 5 });

    expect(findSimilar).toHaveBeenCalledWith('p1', { dao: 'compound', limit: 5 });
    expect(out).toEqual([
      {
        dao_slug: 'compound',
        dao_name: 'Compound',
        source_type: 'compound_governor_bravo',
        source_id: '42',
        title: 'Raise reserve factor',
        state: 'active',
        created_at: '2026-01-02T03:04:05Z',
        voting_starts_at: '2026-01-03T00:00:00Z',
        voting_ends_at: null,
        similarity: 0.87,
      },
    ]);
  });

  it('returns [] when the repo finds no neighbours', async () => {
    const svc = new SimilarProposalsReadService({ findSimilar: async () => [] } as never);
    expect(await svc.findSimilar('p1', { limit: 10 })).toEqual([]);
  });
});
