import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';

/**
 * Mismatch analysis (§6.9 / §6.18): the calldata-vs-prose discrepancy detector. Its output is an
 * M5 AI feature; until then the fenced panel states plainly that no analysis has run. When the
 * detector lands, this section renders the severity treatments (consistent / minor / material /
 * severe) with the structured discrepancy list.
 */
export function MismatchSection() {
  return (
    <Section number="03" title="Mismatch analysis">
      <AIPanel label="Mismatch analysis by Kvorum">
        <p className="font-mono text-small text-ink-3">
          Kvorum hasn’t analysed this proposal’s actions against its description yet. Review the
          decoded actions below alongside the description.
        </p>
      </AIPanel>
    </Section>
  );
}
