import Link from 'next/link';

import { daoVariant, stateToVariant } from './state';
import { IdentityChip } from '@/components/ui/identity-chip';
import { Pill } from '@/components/ui/pill';
import { StatePill } from '@/components/ui/state-pill';
import { formatDateTime } from '@/lib/format';
import type { ProposalDetailView } from '@/lib/proposals/detail';
import { sourceExternalLink, sourceLabel } from '@/lib/proposals/source';

/**
 * Proposal header (§6.9 / §6.17): DAO badge, title, the *explicit* source + id, state + timestamp,
 * and a "view on {source}" link where we can build a correct one. The source is always spelled out
 * — "voting power in Lido" means different things per source, so nothing is unified here.
 */
export function ProposalHeader({ detail }: { detail: ProposalDetailView }) {
  const external = sourceExternalLink(detail);
  const timestamp = detail.votingEndsAt ?? detail.votingStartsAt;

  return (
    <header className="flex flex-col gap-4 border-b border-line-2 pb-6">
      <div className="flex flex-wrap items-center gap-2 font-mono text-caption">
        <Pill dao={daoVariant(detail.daoSlug)}>{detail.daoSlug}</Pill>
        <span className="text-ink-3">
          Source: <span className="text-ink-2">{sourceLabel(detail.sourceType)}</span> ·{' '}
          <span className="text-ink-2">#{detail.sourceId}</span>
        </span>
      </div>

      <h1 className="text-h1 font-semibold leading-tight text-ink">
        {detail.title ?? `Proposal #${detail.sourceId}`}
      </h1>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-caption text-ink-3">
        <span className="flex items-center gap-2">
          <StatePill state={stateToVariant(detail.state)}>{detail.state}</StatePill>
          {timestamp && <span suppressHydrationWarning>{formatDateTime(timestamp)}</span>}
          {!detail.binding && <span className="text-note-ink">signaling · non-binding</span>}
        </span>

        <span className="flex items-center gap-1.5">
          <span>by</span>
          <IdentityChip
            address={detail.proposer.address}
            name={detail.proposer.displayName ?? undefined}
          />
        </span>

        {external && (
          <Link
            href={external.href}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-ink-2 underline-offset-2 hover:text-accent hover:underline"
          >
            View on {external.label} ↗
          </Link>
        )}
      </div>
    </header>
  );
}
