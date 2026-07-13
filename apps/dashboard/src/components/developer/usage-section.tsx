import { Section } from '@/components/ui/section';

/**
 * Usage view (§6.13 §2): 30-day request volume by endpoint family + quota progress. The backend
 * usage store isn't wired yet (it lands in ClickHouse once key enforcement is on), so this states
 * its absence honestly rather than rendering an empty chart.
 */
export function UsageSection() {
  return (
    <Section number="2" title="Usage">
      <div className="border border-dashed border-line-2 px-4 py-8 text-center text-small text-ink-3">
        Request-volume charts and quota status appear here once usage analytics are live.
      </div>
    </Section>
  );
}
