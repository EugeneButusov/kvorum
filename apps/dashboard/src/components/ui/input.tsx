import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full border border-line-2 bg-bg px-3 py-1 font-mono text-small text-ink',
        'placeholder:text-ink-4 focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:font-medium',
        className,
      )}
      {...props}
    />
  );
}
