'use client';

import { usePathname } from 'next/navigation';

import { SystemPage } from './system-page';
import { notFoundGuidance, type NotFoundKind } from '@/lib/system/not-found-guidance';

/**
 * Renders the context-aware 404 body (§6.15). `kind` is fixed by the segment's not-found.tsx; the
 * pathname (read client-side, since not-found boundaries don't receive params) supplies the concrete
 * slug/address for the guidance copy.
 */
export function NotFoundContent({ kind = 'generic' }: { kind?: NotFoundKind }) {
  const pathname = usePathname() ?? '';
  const { title, message, actions } = notFoundGuidance(kind, pathname);
  return (
    <SystemPage code="404" title={title} actions={actions}>
      {message}
    </SystemPage>
  );
}
