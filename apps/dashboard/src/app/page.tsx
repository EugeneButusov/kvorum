// Interim verification surface for the design-system foundation: exercises the design
// tokens, both fonts, and light/dark theme wiring so the setup can be eyeballed. Replaced
// wholesale by the real app shell (top nav, homepage) once those land.
import { ThemeToggleDemo } from '@/components/theme-toggle-demo';

const swatches = [
  { name: 'bg', cls: 'bg-bg' },
  { name: 'bg-2', cls: 'bg-bg-2' },
  { name: 'bg-3', cls: 'bg-bg-3' },
  { name: 'primary', cls: 'bg-primary' },
  { name: 'ok', cls: 'bg-ok' },
  { name: 'note', cls: 'bg-note' },
  { name: 'warn', cls: 'bg-warn' },
  { name: 'ink', cls: 'bg-ink' },
];

const label = 'font-mono text-caption uppercase tracking-[0.08em] text-ink-3';

export default function Page() {
  return (
    <main className="min-h-screen space-y-8 bg-bg p-8 text-ink">
      <header className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="font-mono text-h1">Kvorum</h1>
          <p className="text-body text-ink-3">Design-system foundation — interim smoke page</p>
        </div>
        <ThemeToggleDemo />
      </header>

      <section className="space-y-3">
        <h2 className={label}>Token swatches</h2>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {swatches.map((s) => (
            <div key={s.name} className="border border-line-2">
              <div className={`${s.cls} h-12`} />
              <div className="p-1 font-mono text-micro text-ink-2">{s.name}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className={label}>Type</h2>
        <p className="font-sans text-body-lg">
          Sans (Inter) — prose. The quick brown fox jumps over the lazy dog.
        </p>
        <p className="font-mono text-body">
          Mono (JetBrains) — facts. 0x1a2b3c4d · 1,234,567 votes · 99.9%
        </p>
        <p className="font-mono text-body tabular-nums">
          Tabular nums: 1111111 / 8888888 / 12,345.67
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={label}>Severity</h2>
        <div className="flex flex-wrap gap-2 font-mono text-pill">
          <span className="bg-primary px-2 py-1 text-paper">ok / for</span>
          <span className="border border-note bg-note-bg px-2 py-1 text-note-ink">
            note / queued
          </span>
          <span className="border border-warn bg-warn-bg px-2 py-1 text-warn-ink">
            warn / defeated
          </span>
        </div>
      </section>
    </main>
  );
}
