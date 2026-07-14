'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import Link from 'next/link';

import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { cn } from '@/lib/utils';

const mismatchVariants = cva(
  'inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-pill uppercase tracking-[0.04em] transition-colors',
  {
    variants: {
      severity: {
        material: 'border-warn bg-warn-bg text-warn-ink hover:brightness-95',
        severe: 'border-warn bg-warn text-bg-2 hover:brightness-95',
      },
    },
    defaultVariants: { severity: 'material' },
  },
);

export type MismatchProps = VariantProps<typeof mismatchVariants> & {
  /** Tooltip summary of the discrepancy type. */
  summary: string;
  /** Link target to the full mismatch analysis. */
  href: string;
  label?: string;
  className?: string;
};

/** Calldata-vs-prose discrepancy marker (§6.3): icon + label + tooltip + link. */
export function Mismatch({
  severity,
  summary,
  href,
  label = 'Discrepancy detected',
  className,
}: MismatchProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={href} className={cn(mismatchVariants({ severity }), className)}>
          <span aria-hidden>△</span>
          {label}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{summary}</TooltipContent>
    </Tooltip>
  );
}
