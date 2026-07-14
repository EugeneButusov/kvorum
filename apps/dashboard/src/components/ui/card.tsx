import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

type Flaggable = { flagged?: boolean };

/** Generic surface block: thin border on the card surface. `flagged` → warn treatment. */
export function Card({ flagged = false, className, ...props }: ComponentProps<'div'> & Flaggable) {
  return (
    <div
      className={cn('border bg-bg-2', flagged ? 'border-warn' : 'border-line-3', className)}
      {...props}
    />
  );
}

/** Card header — mono uppercase label. Pass `flagged` to match a flagged Card. */
export function CardHeader({
  flagged = false,
  className,
  ...props
}: ComponentProps<'div'> & Flaggable) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b px-[14px] py-2.5 font-mono text-caption font-semibold uppercase tracking-[0.08em]',
        flagged ? 'border-warn bg-warn-bg text-warn-ink' : 'border-line-3 bg-bg text-ink-3',
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-[14px]', className)} {...props} />;
}
