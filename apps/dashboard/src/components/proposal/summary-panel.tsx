import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';

/**
 * AI summary (§6.9 / §6.18). The generation pipeline lands in M5; until then the panel renders its
 * fenced empty state — never un-fenced prose — and points the reader at the description below.
 */
export function SummaryPanel() {
  return (
    <Section number="01" title="Summary">
      <AIPanel
        label="Summary by Kvorum"
        sourceHref="#description"
        sourceLabel="Read the description"
      >
        <p className="font-mono text-small text-ink-3">
          An AI summary for this proposal isn’t available yet. Read the full description below.
        </p>
      </AIPanel>
    </Section>
  );
}
