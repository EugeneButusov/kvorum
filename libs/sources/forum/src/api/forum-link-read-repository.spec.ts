import { describe, expect, it, vi } from 'vitest';
import { ForumLinkReadRepository } from './forum-link-read-repository';

function mockPg(rows: Array<Record<string, unknown>>) {
  const builder: Record<string, unknown> = {};
  for (const m of ['innerJoin', 'select', 'where']) builder[m] = vi.fn(() => builder);
  builder['execute'] = vi.fn().mockResolvedValue(rows);
  const selectFrom = vi.fn(() => builder);
  return { db: { selectFrom } as never, selectFrom };
}

describe('ForumLinkReadRepository', () => {
  it('constructs URLs, converts activity to ISO seconds, and orders high→medium', async () => {
    const { db, selectFrom } = mockPg([
      {
        confidence: 'medium',
        forum_host: 'research.lido.fi',
        forum_topic_id: '20',
        title: 'ARFC thread',
        last_activity_at: new Date('2026-05-10T08:00:00.500Z'),
      },
      {
        confidence: 'high',
        forum_host: 'research.lido.fi',
        forum_topic_id: '10',
        title: 'Proposal thread',
        last_activity_at: new Date('2026-05-09T08:00:00Z'),
      },
    ]);
    const repo = new ForumLinkReadRepository(db);

    const links = await repo.getLinksForProposal('p1');
    expect(selectFrom).toHaveBeenCalledWith('proposal_forum_link as pfl');
    expect(links).toEqual([
      {
        platform: 'discourse',
        host: 'research.lido.fi',
        url: 'https://research.lido.fi/t/10',
        title: 'Proposal thread',
        confidence: 'high',
        last_activity_at: '2026-05-09T08:00:00Z',
      },
      {
        platform: 'discourse',
        host: 'research.lido.fi',
        url: 'https://research.lido.fi/t/20',
        title: 'ARFC thread',
        confidence: 'medium',
        last_activity_at: '2026-05-10T08:00:00Z',
      },
    ]);
  });

  it('handles a null last_activity_at and returns an empty list', async () => {
    const { db } = mockPg([
      {
        confidence: 'high',
        forum_host: 'www.comp.xyz',
        forum_topic_id: '5',
        title: null,
        last_activity_at: null,
      },
    ]);
    const repo = new ForumLinkReadRepository(db);
    const links = await repo.getLinksForProposal('p1');
    expect(links[0]?.last_activity_at).toBeNull();
    expect(links[0]?.url).toBe('https://www.comp.xyz/t/5');

    const { db: emptyDb } = mockPg([]);
    await expect(new ForumLinkReadRepository(emptyDb).getLinksForProposal('p2')).resolves.toEqual(
      [],
    );
  });

  describe('getPrimaryThreadContent', () => {
    it('returns the highest-confidence thread content, then most recent activity', async () => {
      const { db } = mockPg([
        {
          confidence: 'medium',
          raw_content: 'medium body',
          last_activity_at: new Date('2026-05-10T08:00:00Z'),
        },
        {
          confidence: 'high',
          raw_content: 'high, older',
          last_activity_at: new Date('2026-05-01T08:00:00Z'),
        },
        {
          confidence: 'high',
          raw_content: 'high, newer',
          last_activity_at: new Date('2026-05-09T08:00:00Z'),
        },
      ]);
      await expect(new ForumLinkReadRepository(db).getPrimaryThreadContent('p1')).resolves.toEqual({
        raw_content: 'high, newer',
      });
    });

    it('returns null when the proposal has no linked thread with content', async () => {
      const { db } = mockPg([]);
      await expect(
        new ForumLinkReadRepository(db).getPrimaryThreadContent('p2'),
      ).resolves.toBeNull();
    });
  });
});
