'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export type SubNavItem = { id: string; label: string };

/**
 * Anchored "On this page" TOC (§6.9). Highlights the section in view. Presentational — stickiness
 * lives on the wrapping <aside> in the page (the reference makes the aside itself sticky, which
 * gives it room to pin; a sticky element inside a shrink-wrapped parent can't move and never sticks).
 */
export function SubNav({ items }: { items: SubNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const sections = items
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el != null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="On this page" className="flex flex-col gap-2">
      <p className="px-3 font-mono text-caption uppercase tracking-[0.1em] text-ink-3">
        On this page
      </p>
      <ul>
        {items.map((it, i) => {
          const isActive = active === it.id;
          return (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex items-baseline gap-2.5 border-l-2 px-3 py-[7px] text-body transition-colors',
                  isActive
                    ? 'border-primary bg-bg-2 font-semibold text-ink'
                    : 'border-transparent text-ink-2 hover:text-ink',
                )}
              >
                <span
                  className={cn(
                    'w-4 shrink-0 font-mono text-caption',
                    isActive ? 'text-primary' : 'text-ink-4',
                  )}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                {it.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
