import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type SectionProps = Omit<ComponentProps<'section'>, 'title'> & {
  number?: string | number;
  title: ReactNode;
  /** Optional right-aligned reference slot (e.g. source, block). */
  reference?: ReactNode;
};

/** Numbered, uppercase-mono section header with a bottom rule. */
export function Section({ number, title, reference, className, children, ...props }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-[14px]', className)} {...props}>
      <header className="flex items-baseline gap-4 border-b border-line-3 pb-2.5">
        <h2 className="font-mono text-body font-semibold uppercase tracking-[0.06em]">
          {number != null && <span className="mr-2 font-medium text-ink-3">{number}</span>}
          {title}
        </h2>
        {reference != null && (
          <div className="ml-auto flex items-center gap-2 font-mono text-caption uppercase tracking-[0.06em] text-ink-3">
            {reference}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}
