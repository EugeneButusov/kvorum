'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/** Secondary DAO-context nav: Overview / Health / Proposals / Delegates. */
export function DaoNav({ slug }: { slug: string }) {
  const pathname = usePathname() ?? '';
  const base = `/daos/${slug}`;
  const items = [
    { label: 'Overview', href: base },
    { label: 'Health', href: `${base}/health` },
    { label: 'Proposals', href: `${base}/proposals` },
    { label: 'Delegates', href: `${base}/delegates` },
  ];

  return (
    <nav className="flex items-stretch border-b border-line-2 bg-bg-2 px-8">
      {items.map((it) => {
        const active = it.href === base ? pathname === base : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              '-mb-px flex items-center border-b-2 px-4 py-2.5 font-mono text-small transition-colors',
              active ? 'border-primary text-ink' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
