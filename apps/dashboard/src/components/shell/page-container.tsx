import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Centered page content column (§6 reference `main.home`): max-width capped, auto-margined,
 * with the horizontal gutter + vertical rhythm the hi-fi mockups use
 * (padding: --space-7 --gutter --space-16). Wraps the per-page content only — the top-nav,
 * breadcrumb, DAO sub-nav, and footer stay full-bleed strips outside it.
 */
export function PageContainer({ className, ...props }: ComponentProps<'main'>) {
  return (
    <main
      className={cn('mx-auto w-full max-w-page px-4 pb-16 pt-7 md:px-8', className)}
      {...props}
    />
  );
}
