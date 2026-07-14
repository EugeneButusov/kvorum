import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const bannerVariants = cva('flex items-center gap-[14px] border px-4 py-3 text-body', {
  variants: {
    severity: {
      warn: 'border-warn bg-warn-bg text-warn-ink',
      note: 'border-note bg-note-bg text-note-ink',
      ok: 'border-ok bg-ok-bg text-ok-ink',
    },
  },
  defaultVariants: { severity: 'note' },
});

const glyphClass: Record<NonNullable<VariantProps<typeof bannerVariants>['severity']>, string> = {
  warn: 'bg-warn text-warn-bg',
  note: 'bg-note text-note-bg',
  ok: 'bg-ok text-ok-bg',
};

export type BannerProps = Omit<ComponentProps<'div'>, 'children'> &
  VariantProps<typeof bannerVariants> & {
    /** Optional leading square glyph (icon or single char). */
    glyph?: ReactNode;
    /** Optional trailing node — a jump link, confidence figure, etc. */
    action?: ReactNode;
    children?: ReactNode;
  };

export function Banner({
  className,
  severity = 'note',
  glyph,
  action,
  children,
  ...props
}: BannerProps) {
  return (
    <div className={cn(bannerVariants({ severity }), className)} {...props}>
      {glyph != null && (
        <span
          className={cn(
            'grid size-5 shrink-0 place-items-center font-mono text-body font-bold',
            glyphClass[severity ?? 'note'],
          )}
        >
          {glyph}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export { bannerVariants };
