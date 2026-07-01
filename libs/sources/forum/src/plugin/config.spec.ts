import { describe, expect, it } from 'vitest';
import { parseForumConfig } from './config';

describe('parseForumConfig', () => {
  it('accepts a host with one or more category slugs', () => {
    expect(parseForumConfig({ host: 'research.lido.fi', categories: ['proposals'] })).toEqual({
      host: 'research.lido.fi',
      categories: ['proposals'],
    });
    expect(
      parseForumConfig({ host: 'www.comp.xyz', categories: ['governance', 'proposals'] }),
    ).toEqual({ host: 'www.comp.xyz', categories: ['governance', 'proposals'] });
  });

  it('rejects a missing host, empty host, or empty category list', () => {
    expect(() => parseForumConfig({ categories: ['x'] })).toThrow();
    expect(() => parseForumConfig({ host: '', categories: ['x'] })).toThrow();
    expect(() => parseForumConfig({ host: 'h', categories: [] })).toThrow();
    expect(() => parseForumConfig({ host: 'h', categories: [''] })).toThrow();
  });
});
