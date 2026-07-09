import { cn } from '@/lib/utils';

/**
 * Promoted search affordance in the top bar. Presentational for now — the search
 * experience (results page, ⌘K palette) lands in a later milestone.
 */
export function SearchBox({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex min-w-[260px] items-center gap-2 border border-line-2 bg-bg px-2.5 py-1.5 font-mono text-small text-ink-3',
        className,
      )}
    >
      <span aria-hidden>⌕</span>
      <span className="flex-1 truncate">Search proposals, addresses, txs…</span>
      <kbd className="border border-line-2 px-1.5 text-micro">⌘K</kbd>
    </div>
  );
}
