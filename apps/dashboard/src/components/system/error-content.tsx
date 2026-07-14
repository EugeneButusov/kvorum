'use client';

import { SystemPage } from './system-page';
import { Button } from '@/components/ui/button';

/**
 * 500 body (§6.15). States plainly that the failure is on Kvorum's side, surfaces the error
 * reference (Next's server-generated `digest`, logged server-side with full context) so a reporter
 * can quote it, and shows no stack traces / internal paths. No auto-redirect — the user may want to
 * retry this exact URL, so we offer an explicit "Try again" instead.
 */
export function ErrorContent({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  return (
    <SystemPage code="500" title="Something went wrong" actions={[{ label: '← Home', href: '/' }]}>
      <p>
        Something went wrong on Kvorum’s side. This isn’t your fault — the error has been logged.
      </p>
      {error.digest && (
        <p className="mt-3 text-small text-ink-3">
          Error reference: <code className="text-ink-2">{error.digest}</code>
          <br />
          Include this if you report the problem.
        </p>
      )}
      {reset && (
        <span className="mt-5 inline-block">
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        </span>
      )}
    </SystemPage>
  );
}
