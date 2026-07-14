/** Minimal interim page body — used until each real page ships in its own milestone. */
export function PagePlaceholder({ title, note }: { title: string; note?: string }) {
  return (
    <main className="mx-auto max-w-[1440px] px-8 py-10">
      <h1 className="font-mono text-h1">{title}</h1>
      <p className="mt-3 max-w-2xl text-body-lg text-ink-2">
        {note ?? 'This page lands in a later milestone. The app shell is in place.'}
      </p>
    </main>
  );
}
