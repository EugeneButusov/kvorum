import { Section } from '@/components/ui/section';

/**
 * Similar proposals (§6.9). Populated by the embedding-similarity search that lands in M5; until
 * then the section states its absence plainly rather than pretending the feature doesn't exist.
 */
export function SimilarSection() {
  return (
    <Section number="08" title="Similar proposals">
      <p className="font-mono text-mono-body text-ink-3">
        Historically similar proposals appear here once Kvorum’s similarity search is live.
      </p>
    </Section>
  );
}
