import { AIPanel } from '@/components/ui/ai-panel';

/**
 * Forum synthesis (§6.12 §2): arguments for/against, unresolved concerns, notable participants,
 * sentiment. An M5 AI feature; until then the fenced panel states its absence and points at the
 * raw thread below rather than pretending the feature doesn't exist.
 */
export function ForumSynthesis({ sourceHref }: { sourceHref: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Synthesis</h2>
      <AIPanel
        label="Forum synthesis by Kvorum"
        sourceHref={sourceHref}
        sourceLabel="Read the thread"
      >
        <p className="font-mono text-small text-ink-3">
          Arguments for and against, unresolved concerns, notable participants, and a sentiment read
          appear here once Kvorum’s forum synthesizer is live. Until then, the full thread is below.
        </p>
      </AIPanel>
    </section>
  );
}
