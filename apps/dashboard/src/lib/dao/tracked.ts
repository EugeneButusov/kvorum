// The DAOs Kvorum tracks, in display order. Single source for the nav, the context-aware 404, and
// anywhere else that enumerates coverage. Adding a DAO is a one-line change here.
export const TRACKED_DAOS: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: 'compound', name: 'Compound' },
  { slug: 'aave', name: 'Aave' },
  { slug: 'lido', name: 'Lido' },
];

const NAME_BY_SLUG = new Map(TRACKED_DAOS.map((d) => [d.slug, d.name]));

/** Display name for a DAO slug — the tracked name when known, else a capitalised fallback. */
export function daoNameFromSlug(slug: string): string {
  return NAME_BY_SLUG.get(slug) ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Human list of tracked DAO names, e.g. "Compound, Aave, and Lido". */
export function trackedDaoList(): string {
  const names = TRACKED_DAOS.map((d) => d.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}
