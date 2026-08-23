import { ForumSynthesisBody } from '@/components/ai/forum-synthesis-body';
import { AIPanel } from '@/components/ui/ai-panel';
import { toProvenance, type ForumSynthesisSection } from '@/lib/ai/panel';

/**
 * Forum synthesis on the standalone thread page (§6.12 §2): arguments for/against, unresolved
 * concerns, notable participants, sentiment. Reuses the shared synthesis body and the same fenced
 * AIPanel as the proposal detail page. A non-English thread is surfaced as a plain (non-AI) note;
 * an unprocessed thread as a fenced coming-soon; the raw thread is always below regardless.
 */
export function ForumSynthesis({
  synthesis,
  sourceHref,
}: {
  synthesis: ForumSynthesisSection;
  sourceHref: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Synthesis</h2>
      {synthesis.state === 'skipped' ? (
        <p className="font-mono text-small text-ink-3">
          This thread isn’t in English, so Kvorum didn’t synthesise it. The full thread is below.
        </p>
      ) : synthesis.state === 'ok' ? (
        <AIPanel
          label="Forum synthesis by Kvorum"
          provenance={toProvenance(synthesis.meta)}
          sourceHref={sourceHref}
          sourceLabel="Read the thread"
        >
          <ForumSynthesisBody synthesis={synthesis.data} />
        </AIPanel>
      ) : (
        <AIPanel
          state={synthesis.state === 'failed' ? 'failed' : 'coming-soon'}
          label="Forum synthesis by Kvorum"
          comingSoonLabel="A synthesis of the discussion"
          fallbackHref={sourceHref}
          fallbackLabel="Read the thread"
        />
      )}
    </section>
  );
}
