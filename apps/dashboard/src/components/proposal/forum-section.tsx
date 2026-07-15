import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';
import type { OffchainLinkView } from '@/lib/proposals/detail';

const CONFIDENCE_LABEL: Record<OffchainLinkView['confidence'], string> = {
  high: 'high confidence',
  medium: 'medium confidence',
  low: 'low confidence',
};

/**
 * Forum (§6.9). The discussion links are indexed facts; the synthesis is AI (M5). We only surface
 * high/medium-confidence links per §6.18 — low-confidence matches aren't shown here.
 */
export function ForumSection({ links }: { links: OffchainLinkView[] }) {
  const shown = links.filter((l) => l.confidence !== 'low');

  return (
    <Section number="07" title="Forum">
      {shown.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">
          No forum thread is confidently linked to this proposal.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
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
          <AIPanel label="Forum synthesis by Kvorum">
            <p className="font-mono text-small text-ink-3">
              A synthesis of the discussion isn’t available yet. Open the thread above to read it in
              full.
            </p>
          </AIPanel>
        </div>
      )}
    </Section>
  );
}
