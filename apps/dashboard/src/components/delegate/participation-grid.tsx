import { seriesColor } from '@/components/charts/chart-colors';
import { Figure } from '@/components/charts/figure';
import type { ParticipationCell } from '@/lib/analytics/delegate';

/**
 * Participation calendar-grid (§6.11 §3): one square per proposal — filled and colour-coded by choice
 * index when the delegate voted, outlined when they missed it. The at-a-glance read is reliability;
 * exact per-proposal detail lives in the table alternative (choice labels aren't in this context).
 */
export function ParticipationGrid({ cells }: { cells: ParticipationCell[] }) {
  const table = {
    columns: [
      { key: 'proposal', label: 'Proposal' },
      { key: 'voted', label: 'Voted' },
      { key: 'choice', label: 'Choice' },
    ],
    rows: cells.map((c) => ({
      proposal: c.title,
      voted: c.voted ? 'Yes' : 'No',
      // The proposal names its own choices; an index means nothing to a reader.
      choice: c.choiceLabel ?? (c.voted ? 'voted' : '—'),
    })),
  };

  return (
    <Figure
      title="Participation"
      table={table}
      caption="Each square is a proposal — filled + colour-coded by choice when voted, outlined when missed."
    >
      {cells.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No proposals to show.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {cells.map((c) => (
            <span
              key={c.key}
              title={`${c.title} — ${c.voted ? `voted ${c.choiceLabel ?? ''}`.trim() : 'did not vote'}`}
              className="h-4 w-4 border"
              style={
                c.voted
                  ? {
                      backgroundColor:
                        c.choiceIndex == null ? 'var(--ink-3)' : seriesColor(c.choiceIndex),
                      borderColor: 'transparent',
                    }
                  : { borderColor: 'var(--line-2)' }
              }
            />
          ))}
        </div>
      )}
    </Figure>
  );
}
