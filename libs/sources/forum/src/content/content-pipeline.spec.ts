import { describe, expect, it } from 'vitest';
import { CONTENT_PIPELINE_VERSION, normalizePost, renderThread } from './content-pipeline';
import { cookedCases } from '../../tests/fixtures/cooked-samples';
import type { DiscourseThread } from '../client/types';

describe('normalizePost (ADR-034 turndown rules)', () => {
  for (const c of cookedCases) {
    it(c.name, () => {
      const md = normalizePost(c.html);
      for (const needle of c.expect) expect(md).toContain(needle);
      for (const banned of c.reject ?? []) expect(md).not.toContain(banned);
    });
  }

  it('drops an onebox with no resolvable link to nothing', () => {
    expect(
      normalizePost('<aside class="onebox"><article>no link here</article></aside>').trim(),
    ).toBe('');
  });

  it('drops an image with neither alt nor src to nothing', () => {
    expect(normalizePost('<p><img></p>')).toBe('');
  });

  it('is deterministic for a given input', () => {
    const html =
      '<h2>Plan</h2><p>Body with <a href="https://x.io">link</a> and <code>code</code>.</p>';
    expect(normalizePost(html)).toBe(normalizePost(html));
  });

  it('handles empty / whitespace HTML without throwing', () => {
    expect(normalizePost('')).toBe('');
    expect(normalizePost('   ')).toBe('');
  });
});

describe('CONTENT_PIPELINE_VERSION', () => {
  it('encodes the pinned turndown version and rules revision (ADR-034)', () => {
    expect(CONTENT_PIPELINE_VERSION).toMatch(/^turndown@\d+\.\d+\.\d+\+rules-v\d+$/);
  });
});

function thread(posts: DiscourseThread['posts']): DiscourseThread {
  return {
    topicId: 1,
    title: 'T',
    postCount: posts.length,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: null,
    posts,
  };
}

describe('renderThread', () => {
  const posts: DiscourseThread['posts'] = [
    {
      id: 1,
      username: 'alice',
      createdAt: '2026-01-01T00:00:00.000Z',
      cooked: '<p>first</p>',
      postNumber: 1,
    },
    {
      id: 2,
      username: 'bob',
      createdAt: '2026-01-02T00:00:00.000Z',
      cooked: '<p>second</p>',
      postNumber: 2,
    },
  ];

  it('prefixes each post with a @user + iso8601 header and joins with a --- separator', () => {
    const out = renderThread(thread(posts), 'research.lido.fi');
    expect(out.rawContent).toBe(
      '**@alice** at 2026-01-01T00:00:00.000Z\n\nfirst\n\n---\n\n**@bob** at 2026-01-02T00:00:00.000Z\n\nsecond',
    );
    expect(out.postCount).toBe(2);
    expect(out.contentPipelineVersion).toBe(CONTENT_PIPELINE_VERSION);
  });

  it('is deterministic', () => {
    expect(renderThread(thread(posts), 'h').rawContent).toBe(
      renderThread(thread(posts), 'h').rawContent,
    );
  });

  it('keeps the header and continues when a post fails to normalise', () => {
    const throwing = (): string => {
      throw new Error('boom');
    };
    const out = renderThread(thread(posts), 'research.lido.fi', throwing);
    // Bodies are empty but headers + separators survive; the thread is not sunk.
    expect(out.rawContent).toBe(
      '**@alice** at 2026-01-01T00:00:00.000Z\n\n---\n\n**@bob** at 2026-01-02T00:00:00.000Z',
    );
    expect(out.postCount).toBe(2);
  });

  it('renders an empty thread to an empty body', () => {
    expect(renderThread(thread([]), 'h').rawContent).toBe('');
  });
});
