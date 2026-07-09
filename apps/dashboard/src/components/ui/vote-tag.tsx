import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const voteTagVariants = cva(
  'inline-block border px-2 py-[3px] font-mono text-micro font-bold uppercase tracking-[0.08em]',
  {
    variants: {
      choice: {
        for: 'border-vote-for bg-vote-for text-bg-2',
        against: 'border-vote-against bg-vote-against text-bg-2',
        abstain: 'border-ink-3 bg-transparent text-ink-2',
      },
    },
    defaultVariants: { choice: 'abstain' },
  },
);

export type VoteTagProps = ComponentProps<'span'> & VariantProps<typeof voteTagVariants>;

export function VoteTag({ className, choice, ...props }: VoteTagProps) {
  return <span className={cn(voteTagVariants({ choice }), className)} {...props} />;
}

export { voteTagVariants };
