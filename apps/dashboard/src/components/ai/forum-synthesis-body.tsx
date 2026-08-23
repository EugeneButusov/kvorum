import type { ForumSynthesis } from '@/lib/ai/panel';
import { cn } from '@/lib/utils';

// Shared renderer for a forum-thread synthesis (§5.7 / §6.12). Used inside the fenced AIPanel on the
// proposal detail page and on the standalone forum-thread page, so the two never drift apart.

const SENTIMENT_TONE: Record<ForumSynthesis['sentiment'], string> = {
  favorable: 'text-ink-2 border-line-2',
  mixed: 'text-note-ink border-note',
  unfavorable: 'text-warn-ink border-warn',
  contentious: 'text-warn-ink border-warn',
};

const HEALTH_TONE: Record<ForumSynthesis['thread_health'], string> = {
  constructive: 'text-ink-2 border-line-2',
  mixed: 'text-note-ink border-note',
  unproductive: 'text-warn-ink border-warn',
};

export function ForumSynthesisBody({ synthesis }: { synthesis: ForumSynthesis }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2 font-mono text-caption uppercase tracking-[0.06em]">
        <Tag className={SENTIMENT_TONE[synthesis.sentiment]}>sentiment · {synthesis.sentiment}</Tag>
        <Tag className={HEALTH_TONE[synthesis.thread_health]}>
          thread · {synthesis.thread_health}
        </Tag>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ArgumentColumn title="Arguments for" args={synthesis.arguments_for} />
        <ArgumentColumn title="Arguments against" args={synthesis.arguments_against} />
      </div>

      {synthesis.unresolved_concerns.length > 0 && (
        <div className="flex flex-col gap-1.5 font-mono text-mono-body">
          <p className="text-caption uppercase tracking-[0.06em] text-note-ink">
            Unresolved concerns
          </p>
          <ul className="flex flex-col gap-1.5">
            {synthesis.unresolved_concerns.map((c, i) => (
              <li key={i} className="text-ink-2">
                {c.summary}
                {c.raised_by.length > 0 && (
                  <span className="ml-2 text-caption text-ink-4">— {c.raised_by.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {synthesis.notable_participants.length > 0 && (
        <div className="flex flex-col gap-1.5 font-mono text-mono-body">
          <p className="text-caption uppercase tracking-[0.06em] text-ink-3">
            Notable participants
          </p>
          <ul className="flex flex-col gap-1">
            {synthesis.notable_participants.map((p) => (
              <li key={p.handle} className="text-ink-2">
                <span className="text-ink">{p.handle}</span>
                <span className="ml-2 text-ink-4">{p.role_summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ArgumentColumn({ title, args }: { title: string; args: ForumSynthesis['arguments_for'] }) {
  return (
    <div className="flex flex-col gap-1.5 font-mono text-mono-body">
      <p className="text-caption uppercase tracking-[0.06em] text-ink-3">{title}</p>
      {args.length === 0 ? (
        <p className="text-ink-4">None surfaced.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {args.map((a, i) => (
            <li key={i} className="text-ink-2">
              {a.summary}
              {a.supporting_participants.length > 0 && (
                <span className="ml-2 text-caption text-ink-4">
                  — {a.supporting_participants.join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tag({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn('border px-1.5 py-0.5', className)}>{children}</span>;
}
