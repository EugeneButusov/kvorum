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
