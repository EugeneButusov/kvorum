/** Canonical site identity, shared by metadata, robots, and the sitemap. */
export const SITE_URL = 'https://kvorum.watch';
export const SITE_NAME = 'Kvorum';
export const SITE_DESCRIPTION = 'On-chain governance, made legible.';

/** External operational-status page, linked from the degraded (503) + maintenance system pages. */
export const STATUS_URL = 'https://status.kvorum.watch';

/**
 * The API reference — Swagger UI served by the API itself, themed to this design system. Linked
 * from the top nav and the developer dashboard's quick links.
 *
 * Overridable so local and preview environments can point at their own API
 * (`http://localhost:3001/v1/docs`). Note `NEXT_PUBLIC_*` is inlined at build time, not read at
 * runtime — setting it on the Deployment would do nothing; production takes the default here.
 */
export const API_DOCS_URL =
  process.env.NEXT_PUBLIC_API_DOCS_URL ?? 'https://api.kvorum.watch/v1/docs';
