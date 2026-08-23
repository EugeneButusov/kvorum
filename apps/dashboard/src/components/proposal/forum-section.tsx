import { ForumSynthesisBody } from '@/components/ai/forum-synthesis-body';
import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';
import { toProvenance, type ForumSynthesisSection } from '@/lib/ai/panel';
import type { OffchainLinkView } from '@/lib/proposals/detail';

const CONFIDENCE_LABEL: Record<OffchainLinkView['confidence'], string> = {
  high: 'high confidence',
  medium: 'medium confidence',
  low: 'low confidence',
};

/**
 * Forum (§6.9). The discussion links are indexed facts; the synthesis is AI. We only surface
 * high/medium-confidence links per §6.18 — low-confidence matches aren't shown. The synthesis panel
 * reflects its fetch state: rendered when present, a fenced coming-soon when unprocessed, a plain
 * (unfenced, non-AI) note when the thread was skipped for being non-English.
 */
export function ForumSection({
  links,
  synthesis,
}: {
  links: OffchainLinkView[];
  synthesis: ForumSynthesisSection;
}) {
  const shown = links.filter((l) => l.confidence !== 'low');
  const primaryHref = shown[0]?.url;

  // Nothing to show at all: no confident link and no synthesis to render.
  if (shown.length === 0 && synthesis.state !== 'ok' && synthesis.state !== 'skipped') {
    return (
      <Section number="07" title="Forum">
        <p className="font-mono text-mono-body text-ink-3">
          No forum thread is confidently linked to this proposal.
        </p>
      </Section>
    );
  }

  return (
    <Section number="07" title="Forum">
      <div className="flex flex-col gap-4">
        {shown.length > 0 && (
          <ul className="flex flex-col gap-2 font-mono text-mono-body">
            {shown.map((link) => (
              <li key={link.url} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline underline-offset-2"
                >
                  {link.title ?? link.host} ↗
                </a>
                <span className="text-caption text-ink-4">
                  {link.platform} · {CONFIDENCE_LABEL[link.confidence]}
                </span>
              </li>
            ))}
          </ul>
        )}

        {synthesis.state === 'skipped' ? (
          // A skip is `ai_generated: false` — surfaced as a plain note, not fenced AI output.
          <p className="font-mono text-small text-ink-3">
            The linked thread isn’t in English, so Kvorum didn’t synthesise it.
          </p>
        ) : synthesis.state === 'ok' ? (
          <AIPanel
            label="Forum synthesis by Kvorum"
            provenance={toProvenance(synthesis.meta)}
            sourceHref={primaryHref}
            sourceLabel="Open the thread"
          >
            <ForumSynthesisBody synthesis={synthesis.data} />
          </AIPanel>
        ) : (
          <AIPanel
            state={synthesis.state === 'failed' ? 'failed' : 'coming-soon'}
            label="Forum synthesis by Kvorum"
            comingSoonLabel="A synthesis of the discussion"
            fallbackHref={primaryHref}
            fallbackLabel="Open the thread"
          />
        )}
      </div>
    </Section>
  );
}
