import { describe, expect, it, vi } from 'vitest';
import { ForumThreadReadRepository } from './forum-thread-read-repository';

// The repo runs two queries off one builder: the thread (executeTakeFirst) then its links (execute).
function mockPg(
  thread: Record<string, unknown> | undefined,
  links: Array<Record<string, unknown>>,
) {
  const builder: Record<string, unknown> = {};
  for (const m of ['innerJoin', 'select', 'where']) builder[m] = vi.fn(() => builder);
  builder['executeTakeFirst'] = vi.fn().mockResolvedValue(thread);
  builder['execute'] = vi.fn().mockResolvedValue(links);
  return { selectFrom: vi.fn(() => builder) } as never;
}

describe('ForumThreadReadRepository', () => {
  it('shapes the thread, builds the source URL + ISO date, and orders links high→medium', async () => {
    const db = mockPg(
      {
        id: 't1',
        forum_host: 'research.lido.fi',
        forum_topic_id: '4821',
        title: 'Increase limit',
        raw_content: 'body',
        post_count: 12,
        last_activity_at: new Date('2026-07-01T08:00:00.500Z'),
      },
      [
        { source_type: 'snapshot', source_id: '0xff', title: 'Signal', confidence: 'medium' },
        { source_type: 'aragon_voting', source_id: '42', title: 'Binding', confidence: 'high' },
      ],
    );

    const out = await new ForumThreadReadRepository(db).getThread('lido', '4821');
    expect(out).toEqual({
      external_id: '4821',
      host: 'research.lido.fi',
      source_url: 'https://research.lido.fi/t/4821',
      title: 'Increase limit',
      raw_content: 'body',
      post_count: 12,
      last_activity_at: '2026-07-01T08:00:00Z',
      linked_proposals: [
        { source_type: 'aragon_voting', source_id: '42', title: 'Binding', confidence: 'high' },
        { source_type: 'snapshot', source_id: '0xff', title: 'Signal', confidence: 'medium' },
      ],
    });
  });

  it('returns undefined when the thread is not found', async () => {
    const out = await new ForumThreadReadRepository(mockPg(undefined, [])).getThread('lido', '999');
    expect(out).toBeUndefined();
  });
});
