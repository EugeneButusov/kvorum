import sitemap from './sitemap';
import { SITE_URL } from '../lib/site';

describe('sitemap', () => {
  it('lists the static top-level routes as absolute https URLs', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(SITE_URL);
    expect(urls).toContain(`${SITE_URL}/proposals`);
    expect(urls).toContain(`${SITE_URL}/daos`);
    expect(urls.every((u) => u.startsWith('https://'))).toBe(true);
  });

  it('gives the homepage top priority', () => {
    const home = sitemap().find((entry) => entry.url === SITE_URL);
    expect(home?.priority).toBe(1);
  });
});
