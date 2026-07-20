import Link from 'next/link';

import { daoVariant, stateToVariant } from '@/components/proposal/state';
import { Pill } from '@/components/ui/pill';
import { StatePill } from '@/components/ui/state-pill';
import { VoteTag } from '@/components/ui/vote-tag';
import type { ActorVoteView, AuthoredProposalView } from '@/lib/actors/actor';
import { formatRelativeTime } from '@/lib/format';
import { classifyChoice } from '@/lib/proposals/detail';
import { sourceLabel } from '@/lib/proposals/source';

/** Recent activity (§6.10 §4): the actor's most recent votes across all DAOs. */
export function ActorActivity({ votes }: { votes: ActorVoteView[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Recent activity</h2>
      {votes.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No votes recorded.</p>
      ) : (
        <ul>
          {votes.map((v) => (
            <li key={v.voteId}>
              <Link
                href={v.href}
                className="flex flex-col gap-1.5 border-b border-line-3 py-3 transition-colors hover:bg-bg-3"
              >
                <div className="flex flex-wrap items-center gap-2 font-mono text-caption">
                  <Pill dao={daoVariant(v.daoSlug)}>{v.daoSlug}</Pill>
                  <span className="text-ink-4">{sourceLabel(v.sourceType)}</span>
                  {/* The proposal's own label, colour-classified as on the proposal page. Falls
                      back to the bare index only when the proposal declares no label for it. */}
                  {v.choiceLabel != null ? (
                    <VoteTag choice={classifyChoice(v.choiceLabel)}>{v.choiceLabel}</VoteTag>
                  ) : (
                    v.primaryChoice != null && (
                      <span className="border border-line-3 px-1.5 text-ink-2">
                        choice #{v.primaryChoice}
                      </span>
                    )
                  )}
                  {v.castAt && (
                    <span className="ml-auto text-ink-3" suppressHydrationWarning>
                      {formatRelativeTime(new Date(v.castAt))}
                    </span>
                  )}
                </div>
                <span className="line-clamp-1 text-body text-ink">
                  {v.title ?? `Proposal #${v.sourceId}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Authored proposals (§6.10 §5): proposals this actor has proposed across all DAOs. */
export function AuthoredProposals({ proposals }: { proposals: AuthoredProposalView[] }) {
  if (proposals.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Authored proposals</h2>
      <ul>
        {proposals.map((p) => (
          <li key={`${p.daoSlug}:${p.sourceType}:${p.sourceId}`}>
            <Link
              href={p.href}
              className="flex flex-wrap items-center gap-2 border-b border-line-3 py-3 font-mono text-caption transition-colors hover:bg-bg-3"
            >
              <Pill dao={daoVariant(p.daoSlug)}>{p.daoSlug}</Pill>
              <StatePill state={stateToVariant(p.state)}>{p.state}</StatePill>
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {p.title ?? `Proposal #${p.sourceId}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
