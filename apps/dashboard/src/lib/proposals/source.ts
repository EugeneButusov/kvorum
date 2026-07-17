// "View on {source}" external deep-link (§6.9 header). We only emit a link when we can build a
// correct one from data we hold; an absent link is honest, a wrong link is not. Snapshot is
// deep-linkable from its space id; extend per source as the mappings are verified.

import type { ProposalDetailView } from './detail';

export type SourceLink = { href: string; label: string };

export function sourceExternalLink(detail: ProposalDetailView): SourceLink | null {
  const meta = detail.metadata;
  if (meta?.kind === 'snapshot' && meta.space_id) {
    return {
      href: `https://snapshot.org/#/${meta.space_id}/proposal/${detail.sourceId}`,
      label: 'Snapshot',
    };
  }
  return null;
}

/** Human label for a source_type, e.g. `aragon_voting` → "Aragon voting". */
export function sourceLabel(sourceType: string): string {
  return sourceType
    .split('_')
    .map((part, i) => (i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/**
 * Source-filter options from the raw `dao_source` source_types of a DAO.
 *
 * The sources endpoint returns one row per dao_source, i.e. per (source_type, chain_id), so a
 * multi-chain source like Aave's payloads controller arrives once per chain — 20+ identical chips
 * without this. `*_reconcile` rows are the indexer's state-reconciler plumbing rather than a source
 * any proposal carries, so filtering by one always returns nothing: drop them.
 */
export function sourceFilterOptions(sourceTypes: readonly string[]): string[] {
  const offerable = sourceTypes.filter((sourceType) => !sourceType.endsWith('_reconcile'));
  return [...new Set(offerable)].sort();
}
