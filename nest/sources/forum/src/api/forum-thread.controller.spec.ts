import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ForumThreadRead, ForumThreadReadRepository } from '@sources/forum';
import { ForumThreadController } from './forum-thread.controller';

const thread: ForumThreadRead = {
  external_id: '4821',
  host: 'research.lido.fi',
  source_url: 'https://research.lido.fi/t/4821',
  title: 'Increase staking limit',
  raw_content: '# Proposal\n\nBody…',
  post_count: 12,
  last_activity_at: '2026-07-01T00:00:00Z',
  linked_proposals: [
    { source_type: 'aragon_voting', source_id: '42', title: 'Increase limit', confidence: 'high' },
  ],
};

describe('ForumThreadController', () => {
  it('returns the thread wrapped in { data }', async () => {
    const repo = { getThread: vi.fn().mockResolvedValue(thread) };
    const controller = new ForumThreadController(repo as unknown as ForumThreadReadRepository);

    const out = await controller.getThread('lido', '4821');
    expect(repo.getThread).toHaveBeenCalledWith('lido', '4821');
    expect(out.data).toBe(thread);
  });

  it('throws NotFoundException when the thread is missing (→ problem-details via the global filter)', async () => {
    const repo = { getThread: vi.fn().mockResolvedValue(undefined) };
    const controller = new ForumThreadController(repo as unknown as ForumThreadReadRepository);

    await expect(controller.getThread('lido', '999')).rejects.toBeInstanceOf(NotFoundException);
  });
});
