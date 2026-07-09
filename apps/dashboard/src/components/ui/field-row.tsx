import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type FieldRowProps = ComponentProps<'div'> & { label: ReactNode };

/** Two-column key/value row for calldata / action params. Dashed divider. */
export function FieldRow({ label, className, children, ...props }: FieldRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-[140px_1fr] items-center border-b border-dashed border-line-3 px-[14px] py-2 last:border-b-0',
        className,
      )}
      {...props}
    >
      <span className="font-mono text-caption uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <span className="flex flex-wrap items-center gap-2 break-all font-mono text-dense text-ink">
        {children}
      </span>
    </div>
  );
}
