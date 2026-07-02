import { describe, expect, it, vi } from 'vitest';
import type { ForumLinkRepository } from '@sources/forum';
import { ForumLinkerService } from './forum-linker.service';

function makeRepo(over: Partial<Record<keyof ForumLinkRepository, unknown>> = {}) {
  return {
    findUnscannedProposals: vi.fn().mockResolvedValue([]),
    findThreadsByDao: vi.fn().mockResolvedValue([]),
    insertLink: vi.fn().mockResolvedValue(undefined),
    markProposalsScanned: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ForumLinkRepository & {
    findUnscannedProposals: ReturnType<typeof vi.fn>;
    findThreadsByDao: ReturnType<typeof vi.fn>;
    insertLink: ReturnType<typeof vi.fn>;
    markProposalsScanned: ReturnType<typeof vi.fn>;
  };
}

describe('ForumLinkerService', () => {
  it('does nothing when no proposals are pending', async () => {
    const repo = makeRepo();
    await new ForumLinkerService(repo).tick();
    expect(repo.findThreadsByDao).not.toHaveBeenCalled();
    expect(repo.markProposalsScanned).not.toHaveBeenCalled();
  });

  it('loads each DAO’s threads once, inserts computed links, and marks proposals scanned', async () => {
    const repo = makeRepo({
      findUnscannedProposals: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          daoId: 'dao-1',
          title: 'Add feed',
          description: 'https://research.lido.fi/t/x/100',
        },
        { id: 'p2', daoId: 'dao-1', title: 'Raise limit', description: 'no link' },
      ]),
      findThreadsByDao: vi.fn().mockResolvedValue([
        { id: 't1', forumHost: 'research.lido.fi', forumTopicId: '100', title: 'anything' },
        {
          id: 't2',
          forumHost: 'research.lido.fi',
          forumTopicId: '200',
          title: '[ARFC] Raise limit',
        },
      ]),
    });

    await new ForumLinkerService(repo).tick();

    // Threads loaded once for the single DAO, not per proposal.
    expect(repo.findThreadsByDao).toHaveBeenCalledTimes(1);
    expect(repo.findThreadsByDao).toHaveBeenCalledWith('dao-1', expect.any(Number));

    // p1 → high (URL to t1); p2 → medium (title match to t2).
    expect(repo.insertLink).toHaveBeenCalledTimes(2);
    expect(repo.insertLink).toHaveBeenCalledWith({
      proposalId: 'p1',
      forumThreadId: 't1',
      confidence: 'high',
      linkMethod: 'description_url',
    });
    expect(repo.insertLink).toHaveBeenCalledWith({
      proposalId: 'p2',
      forumThreadId: 't2',
      confidence: 'medium',
      linkMethod: 'community_curated',
    });

    expect(repo.markProposalsScanned).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('still marks proposals scanned when nothing matches', async () => {
    const repo = makeRepo({
      findUnscannedProposals: vi
        .fn()
        .mockResolvedValue([{ id: 'p1', daoId: 'dao-1', title: 'x', description: 'y' }]),
      findThreadsByDao: vi.fn().mockResolvedValue([]),
    });
    await new ForumLinkerService(repo).tick();
    expect(repo.insertLink).not.toHaveBeenCalled();
    expect(repo.markProposalsScanned).toHaveBeenCalledWith(['p1']);
  });

  it('swallows repository errors (best-effort sweep)', async () => {
    const repo = makeRepo({
      findUnscannedProposals: vi.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(new ForumLinkerService(repo).tick()).resolves.toBeUndefined();
  });
});
