import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const pillVariants = cva(
  'inline-block border bg-bg-2 px-[7px] py-0.5 font-mono text-pill uppercase tracking-[0.04em]',
  {
    variants: {
      dao: {
        none: 'border-line-2 text-ink-2',
        compound: 'border-dao-compound text-dao-compound-ink',
        uniswap: 'border-dao-uniswap text-dao-uniswap-ink',
        aave: 'border-dao-aave text-dao-aave-ink',
        arb: 'border-dao-arb text-dao-arb-ink',
      },
    },
    defaultVariants: { dao: 'none' },
  },
);

export type PillProps = ComponentProps<'span'> & VariantProps<typeof pillVariants>;

export function Pill({ className, dao, ...props }: PillProps) {
  return <span className={cn(pillVariants({ dao }), className)} {...props} />;
}

export { pillVariants };
