import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export type LiveDotProps = ComponentProps<'span'> & { live?: boolean };

/** Small --ok dot. `live` adds a pulsing ring (disabled under reduced-motion). */
export function LiveDot({ live = false, className, ...props }: LiveDotProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 rounded-full bg-ok',
        live && 'animate-kv-pulse motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
