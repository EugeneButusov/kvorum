import Link from 'next/link';

import { formatRelativeTime } from '@/lib/format';
import type { ForumThreadView } from '@/lib/forum/thread';
import { sourceLabel } from '@/lib/proposals/source';
import { cn } from '@/lib/utils';

const CONFIDENCE_STYLE: Record<'high' | 'medium' | 'low', string> = {
  high: 'border-accent bg-accent-bg text-accent-ink',
  medium: 'border-note bg-note-bg text-note-ink',
  low: 'border-line-2 text-ink-3',
};

/** Forum-thread header (§6.12 §1): title, source link, post count, last activity, linked proposals. */
export function ForumHeader({ thread }: { thread: ForumThreadView }) {
  return (
    <header className="flex flex-col gap-3 border-b border-line-2 pb-6">
      <h1 className="text-h1 font-semibold text-ink">
        {thread.title ?? `Forum thread #${thread.externalId}`}
      </h1>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-caption text-ink-3">
        <a href={thread.sourceUrl} rel="noreferrer noopener" className="text-ink-2 hover:text-ink">
          {thread.host} ↗
        </a>
        {thread.postCount != null && <span>{thread.postCount} posts</span>}
        {thread.lastActivityAt && (
          <span suppressHydrationWarning>
            active {formatRelativeTime(new Date(thread.lastActivityAt))}
          </span>
        )}
      </div>

      {thread.linkedProposals.length > 0 && (
        <div className="flex flex-col gap-2 pt-1">
          <span className="font-mono text-caption uppercase tracking-[0.04em] text-ink-4">
            Linked proposals
          </span>
          <ul className="flex flex-col gap-1.5">
            {thread.linkedProposals.map((p) => (
              <li
                key={`${p.sourceType}:${p.sourceId}`}
                className="flex flex-wrap items-center gap-2 font-mono text-caption"
              >
                <span
                  className={cn(
                    'border px-1.5 uppercase tracking-[0.04em]',
                    CONFIDENCE_STYLE[p.confidence],
                  )}
                  title={`${p.confidence} confidence link`}
                >
                  {p.confidence}
                </span>
                <Link href={p.href} className="text-ink hover:text-accent">
                  {p.title ?? `Proposal #${p.sourceId}`}
                </Link>
                <span className="text-ink-4">{sourceLabel(p.sourceType)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
