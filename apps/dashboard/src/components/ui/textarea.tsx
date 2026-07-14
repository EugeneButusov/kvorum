import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full border border-line-2 bg-bg px-3 py-2 font-mono text-small text-ink',
        'placeholder:text-ink-4 focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
