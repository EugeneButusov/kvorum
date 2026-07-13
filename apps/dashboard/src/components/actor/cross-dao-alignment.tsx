import { Heatmap } from '@/components/charts/heatmap';
import type { DaoFootprint } from '@/lib/actors/actor';

/**
 * Cross-DAO alignment (§6.10 §3): how consistently the actor votes with the majority in each DAO,
 * as a one-column heatmap. Shown only when the actor is active in 2+ DAOs with alignment data.
 */
export function CrossDaoAlignment({ footprints }: { footprints: DaoFootprint[] }) {
  const rows = footprints.filter((f) => f.majorityAlignmentPct != null);
  if (rows.length < 2) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Cross-DAO alignment</h2>
      <Heatmap
        title="Alignment with the majority, by DAO"
        rowLabels={rows.map((r) => r.slug)}
        colLabels={['Aligned']}
        cells={rows.map((r) => [Math.round((r.majorityAlignmentPct ?? 0) * 100)])}
        domain={[0, 100]}
        formatValue={(v) => `${v}%`}
        caption="Share of this actor's votes that matched the eventual majority outcome, per DAO."
      />
    </section>
  );
}
