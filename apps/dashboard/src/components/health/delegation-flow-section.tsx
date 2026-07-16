import { DelegationFlow } from '@/components/charts/delegation-flow';
import { Section } from '@/components/ui/section';
import type { DelegationFlowView } from '@/lib/analytics/health';
import { formatCompactNumber } from '@/lib/format';

/** Delegation flow (§6.7 §2): the top 50 delegate–delegator pairs by delegated voting power. */
export function DelegationFlowSection({ view }: { view: DelegationFlowView }) {
  return (
    <Section
      number="02"
      title="Delegation flow"
      reference={view.edges.length > 0 ? <span>{view.edges.length} pairs</span> : undefined}
    >
      {view.edges.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No delegation relationships recorded.</p>
      ) : (
        <DelegationFlow
          title="Top delegate–delegator pairs"
          nodes={view.nodes}
          edges={view.edges}
          formatWeight={(w) => formatCompactNumber(w)}
          caption="Top 50 relationships by delegated voting power. Time scrubber arrives in v1.1."
        />
      )}
    </Section>
  );
}
