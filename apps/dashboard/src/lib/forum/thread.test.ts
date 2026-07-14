import { normalizeThread } from './thread';

describe('normalizeThread', () => {
  it('coerces the generator-mistyped nullable fields and builds linked-proposal hrefs', () => {
    const view = normalizeThread(
      {
        external_id: '4821',
        host: 'research.lido.fi',
        source_url: 'https://research.lido.fi/t/4821',
        title: 'Increase staking limit',
        raw_content: '# Proposal\n\nBody',
        post_count: 12,
        last_activity_at: '2026-07-01T00:00:00Z',
        linked_proposals: [
          {
            source_type: 'aragon_voting',
            source_id: '42',
            title: 'Binding vote',
            confidence: 'high',
          },
          { source_type: 'snapshot', source_id: '0xff', title: null, confidence: 'medium' },
        ],
      } as never,
      'lido',
    );

    expect(view.externalId).toBe('4821');
    expect(view.sourceUrl).toBe('https://research.lido.fi/t/4821');
    expect(view.title).toBe('Increase staking limit');
    expect(view.postCount).toBe(12);
    expect(view.linkedProposals[0]).toEqual({
      sourceType: 'aragon_voting',
      sourceId: '42',
      title: 'Binding vote',
      confidence: 'high',
      href: '/daos/lido/proposals/aragon_voting/42',
    });
    expect(view.linkedProposals[1]!.title).toBeNull();
  });

  it('nulls the untyped-nullable fields when absent', () => {
    const view = normalizeThread(
      {
        external_id: '1',
        host: 'h',
        source_url: 'u',
        title: null,
        raw_content: null,
        post_count: null,
        last_activity_at: null,
        linked_proposals: [],
      } as never,
      'lido',
    );
    expect(view.title).toBeNull();
    expect(view.rawContent).toBeNull();
    expect(view.postCount).toBeNull();
    expect(view.linkedProposals).toEqual([]);
  });
});
