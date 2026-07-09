import Link from 'next/link';
import { Fragment } from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';

export type CrumbItem = { label: string; href?: string };

/** Breadcrumb strip for the app shell. The last item renders as the current page. */
export function Crumb({ items, className }: { items: CrumbItem[]; className?: string }) {
  return (
    <div className={cn('border-b border-line-3 bg-bg-2 px-8 py-2.5', className)}>
      <Breadcrumb>
        <BreadcrumbList>
          {items.map((it, i) => {
            const last = i === items.length - 1;
            return (
              <Fragment key={it.href ?? it.label}>
                <BreadcrumbItem>
                  {last || !it.href ? (
                    <BreadcrumbPage>{it.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={it.href}>{it.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!last && <BreadcrumbSeparator />}
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
