import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site';

// Static top-level routes. DAO- and proposal-scoped URLs join the sitemap as those
// pages bind real data in later milestones.
const ROUTES = ['', '/proposals', '/daos', '/developer', '/docs'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    changeFrequency: route === '' ? 'hourly' : 'daily',
    priority: route === '' ? 1 : 0.7,
  }));
}
