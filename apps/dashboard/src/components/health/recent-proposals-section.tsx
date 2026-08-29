import Link from 'next/link';

import { stateToVariant } from '@/components/proposal/state';
import { Section } from '@/components/ui/section';
import { StatePill } from '@/components/ui/state-pill';
import { formatDeadline } from '@/lib/format';
import type { ProposalListItemView } from '@/lib/proposals/list';

export function RecentProposalsSection({ proposals }: { proposals: ProposalListItemView[] }) {
  return (
    <Section
      number="05"
      title="Recent proposals · this DAO"
      reference={proposals.length > 0 ? <span>last {proposals.length}</span> : undefined}
    >
      {proposals.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No proposals recorded for this DAO.</p>
      ) : (
        <div className="flex flex-col">
          {proposals.map((p) => (
            <ProposalRow key={`${p.sourceType}:${p.sourceId}`} proposal={p} />
          ))}
        </div>
      )}
    </Section>
  );
}

function ProposalRow({ proposal: p }: { proposal: ProposalListItemView }) {
  const forBar = p.tally.find((t) => t.kind === 'for');
  const againstBar = p.tally.find((t) => t.kind === 'against');
  const voteSplit = [
    forBar ? `For ${forBar.pct}%` : null,
    againstBar ? `Agst ${againstBar.pct}%` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  const deadline = p.votingEndsAt ? formatDeadline(p.votingEndsAt) : null;
  const isActive = p.state.toLowerCase() === 'active';

  return (
    <Link
      href={p.href}
      className="grid items-center gap-4 border-b border-dashed border-line-3 px-3.5 py-2.5 text-body transition-colors hover:bg-bg-2 last:border-b-0"
      style={{ gridTemplateColumns: '70px 1fr 110px 100px 130px' }}
    >
      <span className="font-mono text-ink-3">#{p.sourceId}</span>
      <span className="truncate font-medium text-ink">{p.title ?? 'Untitled'}</span>
      <span>
        <StatePill state={stateToVariant(p.state)}>{p.state}</StatePill>
      </span>
      <span className="font-mono text-caption tabular-nums text-ink-2">{voteSplit}</span>
      <span className="text-right font-mono text-caption text-ink-3">
        {isActive && deadline ? <span className="text-primary">{deadline}</span> : deadline}
      </span>
    </Link>
  );
}
