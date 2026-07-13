import { AIPanel } from '@/components/ui/ai-panel';

/**
 * Participation trends (§6.7 §3). The per-proposal participation series (unique voters, VP,
 * % of theoretical max) has no analytics endpoint in v1 — stated honestly rather than faked.
 */
export function ParticipationSection() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Participation trends</h2>
      <p className="font-mono text-mono-body text-ink-3">
        Per-proposal participation (unique voters, voting power, share of the theoretical maximum)
        is served by an analytics endpoint arriving in a later milestone.
      </p>
    </section>
  );
}

/**
 * Flag summary (§6.7 §5): recent mismatch flags. The detector is an M5 AI feature; the empty state
 * ("no discrepancies detected") is itself a useful operator signal.
 */
export function FlagSummary() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Flag summary</h2>
      <AIPanel label="Mismatch detector by Kvorum">
        <p className="font-mono text-small text-ink-3">
          No discrepancies detected. Recent calldata-vs-description flags will appear here once the
          mismatch detector is live.
        </p>
      </AIPanel>
    </section>
  );
}

/**
 * Anomaly indicators (§6.7 §6, KNOWN-018): simple statistical thresholds over the metrics we hold.
 * v1 surfaces a large 90-day swing in top-10 concentration; fuller detection is deferred to v1.1.
 */
export function AnomalySection({ concentrationDelta90 }: { concentrationDelta90: number | null }) {
  const alerts: string[] = [];
  if (concentrationDelta90 != null && Math.abs(concentrationDelta90) >= 5) {
    const dir = concentrationDelta90 > 0 ? 'rose' : 'fell';
    alerts.push(
      `Top-10 voting-power share ${dir} ${Math.abs(concentrationDelta90).toFixed(1)}pp over 90 days.`,
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Anomaly indicators</h2>
      {alerts.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">
          No anomalies flagged. v1 uses simple statistical thresholds (KNOWN-018).
        </p>
      ) : (
        <ul className="flex flex-col gap-2 font-mono text-mono-body">
          {alerts.map((a) => (
            <li key={a} className="flex items-start gap-2 text-warn-ink">
              <span aria-hidden>△</span>
              {a}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
