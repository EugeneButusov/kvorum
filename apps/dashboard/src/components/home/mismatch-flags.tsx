import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';

/**
 * Recent mismatch flags (§6.4 §3) — Kvorum's flagship calldata-vs-prose detector. Currently unmounted
 * from the homepage (issue #608): the feed needs a proposal-keyed AI projection to be queryable
 * cheaply, since `ai_output` is content-addressed with no proposal FK. Kept in place so it can be
 * re-mounted, wired to the feed, when that projection lands.
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
