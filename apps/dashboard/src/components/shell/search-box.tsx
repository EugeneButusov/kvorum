import { cn } from '@/lib/utils';

export function SearchBox({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-[260px] items-center gap-2 border border-line-2 bg-bg px-2.5 py-1.5 font-mono text-small text-ink-3',
        'cursor-pointer transition-colors hover:border-line hover:text-ink',
        className,
      )}
    >
      <span aria-hidden>⌕</span>
      <span className="flex-1 truncate text-left">Search proposals, addresses, txs…</span>
      <kbd className="border border-line-2 px-1.5 text-micro">⌘K</kbd>
    </button>
  );
}
