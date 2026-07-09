import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

// Filled status badge. Text is --bg-2 (near-white in light, near-black in dark) so it
// stays legible on both the mid-tone light fills and the bright dark fills.
const statePillVariants = cva(
  'inline-block border px-2 py-0.5 font-mono text-pill uppercase tracking-[0.06em]',
  {
    variants: {
      state: {
        active: 'border-primary bg-primary text-bg-2',
        passed: 'border-ink bg-ink text-bg-2',
        executed: 'border-ink bg-ink text-bg-2',
        defeated: 'border-warn bg-warn text-bg-2',
        queued: 'border-note bg-note text-bg-2',
        draft: 'border-line-2 bg-bg-2 text-ink-3',
      },
    },
    defaultVariants: { state: 'draft' },
  },
);

export type StatePillProps = ComponentProps<'span'> & VariantProps<typeof statePillVariants>;

export function StatePill({ className, state, ...props }: StatePillProps) {
  return <span className={cn(statePillVariants({ state }), className)} {...props} />;
}

export { statePillVariants };
