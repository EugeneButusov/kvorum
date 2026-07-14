import Link from 'next/link';

import { SearchBox } from '@/components/shell/search-box';
import { cn } from '@/lib/utils';

export type SystemAction = { label: string; href: string };

/**
 * Shared body for the §6.15 system pages (404 / 500 / 503 / maintenance). Same visual language as
 * the rest of the dashboard, scaled down: an eyebrow status code, a title, guidance, action links,
 * and (optionally) the search affordance so users can navigate away to a working page. Presentational
 * — callers own the surrounding chrome and the HTTP status.
 */
export function SystemPage({
  code,
  title,
  children,
  actions = [],
  showSearch = true,
  className,
}: {
  code: string;
  title: string;
  children: React.ReactNode;
  actions?: SystemAction[];
  showSearch?: boolean;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        className,
      )}
    >
      <p className="font-mono text-caption uppercase tracking-[0.08em] text-ink-3">{code}</p>
      <h1 className="font-mono text-h2 text-ink">{title}</h1>
      <div className="max-w-md text-body-lg text-ink-2">{children}</div>

      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {actions.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="font-mono text-small text-primary hover:underline"
            >
              {a.label}
            </Link>
          ))}
        </div>
      )}

      {showSearch && (
        <div className="mt-4 w-full max-w-sm">
          <SearchBox />
        </div>
      )}
    </main>
  );
}
