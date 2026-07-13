import { trackDescription } from '@/lib/dao/tracks';
import { sourceLabel } from '@/lib/proposals/source';

/**
 * Governance tracks (§6.6 §6, §6.17, DR-011): for multi-source DAOs (Lido), the parallel tracks are
 * surfaced explicitly with brief explanations and — deliberately — no unified voting-power figure,
 * because "voting power" means something different in each track.
 */
export function GovernanceTracks({ sourceTypes }: { sourceTypes: string[] }) {
  const tracks = [...new Set(sourceTypes)];
  if (tracks.length <= 1) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Governance tracks</h2>
      <p className="max-w-2xl font-mono text-caption text-ink-3">
        This DAO governs across parallel tracks. There is no single &ldquo;voting power&rdquo;
        figure — each track has its own electorate and semantics.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {tracks.map((source) => (
          <li key={source} className="flex flex-col gap-1.5 border border-line-2 bg-bg-2 p-4">
            <span className="font-mono text-body font-semibold uppercase tracking-[0.04em] text-ink">
              {sourceLabel(source)}
            </span>
            <span className="text-mono-body text-ink-2">{trackDescription(source)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
