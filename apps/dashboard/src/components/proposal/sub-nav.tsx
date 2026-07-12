'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export type SubNavItem = { id: string; label: string };

/** Anchored sub-navigation (§6.9). Sticky; highlights the section in view. */
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
    <nav aria-label="On this page" className="hidden lg:block">
      <ul className="sticky top-24 space-y-1 border-l border-line-3 font-mono text-caption">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              aria-current={active === it.id ? 'true' : undefined}
              className={cn(
                '-ml-px block border-l-2 py-1 pl-3 transition-colors',
                active === it.id
                  ? 'border-primary text-ink'
                  : 'border-transparent text-ink-3 hover:text-ink',
              )}
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
