'use client';

import { ErrorContent } from '@/components/system/error-content';
import { SystemShell } from '@/components/system/system-shell';

// 500 boundary for routes outside the (shell) group (auth pages, maintenance) — brings its own nav.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SystemShell>
      <ErrorContent error={error} reset={reset} />
    </SystemShell>
  );
}
