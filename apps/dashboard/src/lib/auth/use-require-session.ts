'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useSession } from './use-session';

/**
 * Client-side guard for protected pages (§6.13). Middleware already turns away visitors with no
 * session cookie; this catches the case it can't see — a cookie that's present but expired/invalid,
 * where the session read resolves null (directly, or after a 401 clears it). It redirects to login
 * with a return URL so the user lands back where they were after signing in.
 */
export function useRequireSession() {
  const { data: session, isLoading } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && session === null) {
      const next = encodeURIComponent(pathname ?? '/developer');
      router.replace(`/login?next=${next}`);
    }
  }, [isLoading, session, pathname, router]);

  return { session, isLoading };
}
