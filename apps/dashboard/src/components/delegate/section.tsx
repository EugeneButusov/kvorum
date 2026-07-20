import type { ReactNode } from 'react';

/**
 * A numbered section, ported from the design system's `.kv-section` (components.css:272): a mono
 * uppercase heading prefixed with its ordinal, an optional right-aligned reference caption, and a
 * hairline rule. The ordinal is what makes a long profile scannable — the reference leans on it
 * throughout, and the sections read as a numbered dossier rather than a stack of cards.
 */
export function Section({
  number,
  title,
  reference,
  children,
}: {
  number: string;
  title: string;
  reference?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3.5">
      <header className="flex items-baseline gap-4 border-b border-line-3 pb-2.5">
        <h2 className="font-mono text-body font-semibold uppercase tracking-[0.06em] text-ink">
          <span className="mr-2 font-medium text-ink-3">{number}</span>
          {title}
        </h2>
        {reference !== undefined && (
          <span className="ml-auto font-mono text-caption text-ink-3">{reference}</span>
        )}
      </header>
      {children}
    </section>
  );
}
