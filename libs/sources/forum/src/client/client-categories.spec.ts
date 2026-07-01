import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscourseClient } from './client';
import { jsonResponse } from '../../tests/fixtures/discourse-responses';

const liveSignal = (): AbortSignal => new AbortController().signal;

function client(): DiscourseClient {
  return new DiscourseClient({
    baseUrl: 'https://research.lido.fi',
    backoffBaseMs: 1,
    pacer: { maxPerShortWindow: 1_000_000, maxPerLongWindow: 1_000_000 },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DiscourseClient.fetchCategories', () => {
  it('maps /categories.json to slug→id entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        category_list: {
          categories: [
            { id: 9, slug: 'proposals', name: 'Proposals' },
            { id: 1, slug: 'general' },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cats = await client().fetchCategories(liveSignal());

    expect(cats).toEqual([
      { id: 9, slug: 'proposals', name: 'Proposals' },
      { id: 1, slug: 'general', name: null },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://research.lido.fi/categories.json');
  });

  it('returns [] when the category list is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    await expect(client().fetchCategories(liveSignal())).resolves.toEqual([]);
  });
});
