import Link from 'next/link';

// Baseline 404 (Next serves it with a real HTTP 404). The context-aware error pages
// (per-pattern guidance for unknown DAO / proposal / actor) land in a later milestone.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[1440px] flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="font-mono text-caption uppercase tracking-[0.08em] text-ink-3">404</p>
      <h1 className="font-mono text-h1">Page not found</h1>
      <p className="max-w-md text-body-lg text-ink-2">This page could not be found.</p>
      <Link href="/" className="mt-2 font-mono text-small text-primary hover:underline">
        ← Back home
      </Link>
    </main>
  );
}
