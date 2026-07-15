import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';

/**
 * Recent mismatch flags (§6.4 §3) — Kvorum's flagship calldata-vs-prose detector. Its output is an
 * M5 AI feature; until then the section states its absence in the fenced AI treatment rather than
 * pretending the feature doesn't exist.
 */
export function MismatchFlags() {
  return (
    <Section number="02" title="Recent mismatch flags">
      <AIPanel label="Mismatch detector by Kvorum">
        <p className="font-mono text-small text-ink-3">
          Flagged discrepancies between a proposal’s description and its on-chain actions appear
          here once Kvorum’s mismatch detector is live.
        </p>
      </AIPanel>
    </Section>
  );
}
