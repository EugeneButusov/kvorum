'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Segmented control. Pass `type="single"` (+ `value`/`onValueChange`) or `type="multiple"`.
 *
 * Segments wrap onto further rows rather than running off a narrow screen. Each segment draws its
 * own frame and overlaps its neighbour by a pixel, so shared edges collapse to one hairline and every
 * row closes on itself — a group border would instead hang past the end of a part-filled row. On a
 * single row this is pixel-identical to a plain bordered strip.
 */
export function Segmented({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root className={cn('flex flex-wrap pl-px pt-px', className)} {...props} />
  );
}

export function SegmentedItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        // `border-solid` is load-bearing: the global `button { border: 0 }` reset in tokens.css sets
        // border-style to none, and Tailwind's `border` only sets a width — without a style the
        // segment frame computes to 0px and vanishes.
        '-ml-px -mt-px border border-solid border-line-2 px-3 py-[5px] font-mono text-pill uppercase tracking-[0.04em] text-ink-2 transition-colors',
        'hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
        'data-[state=on]:bg-ink data-[state=on]:font-semibold data-[state=on]:text-bg-2',
        className,
      )}
      {...props}
    />
  );
}
