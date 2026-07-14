'use client';

import { ErrorContent } from '@/components/system/error-content';

// 500 boundary for shell routes — nav comes from the (shell) layout, which stays mounted.
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorContent error={error} reset={reset} />;
}
