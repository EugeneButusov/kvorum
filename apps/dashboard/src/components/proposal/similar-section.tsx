import Link from 'next/link';

import { daoVariant, stateToVariant } from '@/components/proposal/state';
import { Pill } from '@/components/ui/pill';
import { Section } from '@/components/ui/section';
import { StatePill } from '@/components/ui/state-pill';
import type { SimilarProposalItem } from '@/lib/ai/panel';

/**
 * Similar proposals (§6.9) — cross-DAO nearest neighbours from proposal embeddings. The endpoint
 * degrades to an empty list (never a 404) when the target has no embedding yet, so an empty result
 * reads as "not available yet" rather than an error. Ranked by cosine similarity.
 */
export function SimilarSection({ items }: { items: SimilarProposalItem[] }) {
  return (
    <Section number="08" title="Similar proposals" reference={<span>AI · embeddings</span>}>
      {items.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">
          No semantically similar proposals found yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-3 border border-line-3 bg-bg-2">
          {items.map((item) => (
            <li key={`${item.dao_slug}/${item.source_type}/${item.source_id}`}>
              <Link
                href={`/daos/${item.dao_slug}/proposals/${item.source_type}/${item.source_id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-3"
              >
                <div className="flex flex-wrap items-center gap-2 font-mono text-caption">
                  <Pill dao={daoVariant(item.dao_slug)}>{item.dao_slug}</Pill>
                  <StatePill state={stateToVariant(item.state)}>{item.state}</StatePill>
                </div>
                <span className="min-w-0 flex-1 truncate text-body-lg text-ink">
                  {item.title ?? `Proposal #${item.source_id}`}
                </span>
                <span
                  className="shrink-0 font-mono text-caption text-ink-3"
                  title="cosine similarity"
                >
                  {Math.round(item.similarity * 100)}%
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
