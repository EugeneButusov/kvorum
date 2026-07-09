import { Crumb } from '@/components/shell/crumb';

export default function HomePage() {
  return (
    <>
      <Crumb items={[{ label: 'Home' }]} />
      <main className="mx-auto max-w-[1440px] px-8 py-10">
        <h1 className="font-mono text-h1">On-chain governance, made legible.</h1>
        <p className="mt-3 max-w-2xl text-body-lg text-ink-2">
          The homepage lands in a later milestone. The app shell — navigation, promoted search, the
          wallet slot, theme toggle, breadcrumb, and the freshness footer — is in place.
        </p>
      </main>
    </>
  );
}
