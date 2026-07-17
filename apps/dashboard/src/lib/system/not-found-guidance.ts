import type { SystemAction } from '@/components/system/system-page';
import { daoNameFromSlug, trackedDaoList } from '@/lib/dao/tracked';
import { truncateAddress } from '@/lib/format';

// Which segment's notFound() fired — passed explicitly by the segment's not-found.tsx, since the
// URL alone can't distinguish an unknown DAO from a known DAO with an unknown proposal.
export type NotFoundKind = 'dao' | 'proposal' | 'actor' | 'generic';

export type NotFoundGuidance = {
  title: string;
  message: string;
  actions: SystemAction[];
};

// Extracts the DAO slug from any /daos/{slug}/… path.
function daoSlug(pathname: string): string | null {
  return /^\/daos\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

// Extracts the address from /actors/{address}.
function actorAddress(pathname: string): string | null {
  return /^\/actors\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * Per-pattern 404 guidance (§6.15). `kind` comes from the segment that 404'd; `pathname` supplies the
 * concrete slug/address for the copy. Always returns actionable next steps — never a dead end.
 */
export function notFoundGuidance(kind: NotFoundKind, pathname: string): NotFoundGuidance {
  if (kind === 'dao') {
    const slug = daoSlug(pathname);
    return {
      title: 'DAO not tracked',
      message: `Kvorum tracks ${trackedDaoList()}. ${
        slug ? `The DAO “${slug}” is` : 'That DAO is'
      } not currently tracked.`,
      actions: [
        { label: 'All DAOs', href: '/daos' },
        { label: '← Home', href: '/' },
      ],
    };
  }

  if (kind === 'proposal') {
    const slug = daoSlug(pathname);
    const dao = slug ? daoNameFromSlug(slug) : 'this DAO';
    return {
      title: 'Proposal not found',
      message: `This proposal doesn’t exist in Kvorum’s index of ${dao}. It may not be from a governance source we track.`,
      actions: [
        ...(slug ? [{ label: `${dao} proposals`, href: `/daos/${slug}/proposals` }] : []),
        { label: '← Home', href: '/' },
      ],
    };
  }

  if (kind === 'actor') {
    const address = actorAddress(pathname);
    return {
      title: 'No activity recorded',
      message: `Kvorum has no governance activity recorded for ${
        address ? `${truncateAddress(address)}` : 'this address'
      }.`,
      actions: [{ label: '← Home', href: '/' }],
    };
  }

  return {
    title: 'Page not found',
    message: 'This page could not be found. It may have moved, or never existed.',
    actions: [{ label: '← Home', href: '/' }],
  };
}
