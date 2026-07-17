import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Centered page content column (§6 reference `main.home`): max-width capped, auto-margined,
 * with the horizontal gutter + vertical rhythm the hi-fi mockups use
 * (padding: --space-7 --gutter --space-16). Wraps the per-page content only — the top-nav,
 * breadcrumb, DAO sub-nav, and footer stay full-bleed strips outside it.
 *
 * A plain <div>, not a <main>: system pages (SystemPage) render their own <main>, and some of
 * them appear as the content of a PageContainer-wrapped route (e.g. the proposal-detail "temporarily
 * unavailable" shell under the DAO layout). A <main> here would nest inside theirs — invalid HTML
 * and two `main` landmarks. Keep this presentational so each page keeps exactly one <main>.
 */
export function PageContainer({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mx-auto w-full max-w-page px-4 pb-16 pt-7 md:px-8', className)}
      {...props}
    />
  );
}
