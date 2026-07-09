import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** Mono footer strip for data-freshness / build / deployment items. */
export function FreshFooter({ className, ...props }: ComponentProps<'footer'>) {
  return (
    <footer
      className={cn(
        'flex flex-wrap justify-between gap-6 border-t border-line-3 bg-bg-2 px-8 py-[14px] font-mono text-pill text-ink-3',
        className,
      )}
      {...props}
    />
  );
}

export function FreshFooterItem({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2', className)} {...props} />;
}
