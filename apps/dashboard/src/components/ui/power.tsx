'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { formatCompactNumber, formatPower } from '@/lib/format';
import { cn } from '@/lib/utils';

export type PowerComposition = { delegatedIn?: number; self?: number; total?: number };

export type PowerProps = {
  value: number;
  /** Unit label, e.g. COMP / UNI / votes. */
  unit?: string;
  referenceBlock?: number;
  /** Underlying composition, revealed on hover/focus. */
  composition?: PowerComposition;
  className?: string;
};

/** Voting-power figure (§6.3): compact number + unit + reference block + composition tooltip. */
export function Power({ value, unit, referenceBlock, composition, className }: PowerProps) {
  const figure = (
    <span
      className={cn('inline-flex items-baseline gap-1 font-mono tabular-nums text-ink', className)}
    >
      <span className="font-semibold">{formatPower(value, unit)}</span>
      {referenceBlock != null && (
        <span className="text-caption text-ink-4">
          as of block {referenceBlock.toLocaleString('en-US')}
        </span>
      )}
    </span>
  );

  if (!composition) return figure;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="cursor-help">
          {figure}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5">
          {composition.delegatedIn != null && (
            <div>delegated-in {formatCompactNumber(composition.delegatedIn)}</div>
          )}
          {composition.self != null && <div>self {formatCompactNumber(composition.self)}</div>}
          {composition.total != null && <div>total {formatCompactNumber(composition.total)}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
