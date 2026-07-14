'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** Segmented control. Pass `type="single"` (+ `value`/`onValueChange`) or `type="multiple"`. */
export function Segmented({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn('inline-flex border border-line-2', className)}
      {...props}
    />
  );
}

export function SegmentedItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        'border-r border-line-2 px-3 py-[5px] font-mono text-pill uppercase tracking-[0.04em] text-ink-2 transition-colors last:border-r-0',
        'hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
        'data-[state=on]:bg-ink data-[state=on]:font-semibold data-[state=on]:text-bg-2',
        className,
      )}
      {...props}
    />
  );
}
