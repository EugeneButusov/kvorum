import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';
import { toAiConfidence, toProvenance, type ProposalAiSummary } from '@/lib/ai/panel';
import { MARKDOWN_PROSE_CLASS } from '@/lib/markdown';

/**
 * AI summary (§6.9 / §6.18). Rides inline on the proposal detail response, so `summary` is null
 * until the summarizer has run (or if it was budget-capped / the content changed). In every state
 * the output stays inside the fenced AIPanel — the TL;DR is never rendered as un-fenced prose — and
 * the reader is always one click from the description below.
 */
export function SummaryPanel({ summary }: { summary: ProposalAiSummary | null }) {
  return (
    <Section number="01" title="Summary">
      {summary === null ? (
        <AIPanel
          state="coming-soon"
          label="Summary by Kvorum"
          comingSoonLabel="An AI summary"
          fallbackHref="#description"
          fallbackLabel="Read the description"
        />
      ) : (
        <AIPanel
          label="Summary by Kvorum"
          confidence={toAiConfidence(summary.proposal_type_confidence)}
          provenance={toProvenance(summary._meta)}
          sourceHref="#description"
          sourceLabel="Read the description"
        >
          <div className="flex flex-col gap-5">
            <div className={MARKDOWN_PROSE_CLASS}>
              <Markdown remarkPlugins={[remarkGfm]}>{summary.tldr}</Markdown>
            </div>
            <SummaryFacts summary={summary} />
          </div>
        </AIPanel>
      )}
    </Section>
  );
}

function SummaryFacts({ summary }: { summary: ProposalAiSummary }) {
  const concerns = summary.notable_concerns ?? [];

  return (
    <div className="flex flex-col gap-4 font-mono text-mono-body">
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <Fact term="Type">{summary.proposal_type.replace(/_/g, ' ')}</Fact>
        {summary.funding_amount_usd && <Fact term="Funding">${summary.funding_amount_usd}</Fact>}
      </dl>

      {summary.key_changes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption uppercase tracking-[0.06em] text-ink-3">Key changes</p>
          <ul className="flex flex-col gap-1.5">
            {summary.key_changes.map((change, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-4" aria-hidden />
                <span className="text-ink">
                  {change.description}
                  {change.significance && (
                    <span className="ml-2 text-caption text-ink-4">({change.significance})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {concerns.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption uppercase tracking-[0.06em] text-note-ink">Notable concerns</p>
          <ul className="flex flex-col gap-1">
            {concerns.map((concern, i) => (
              <li key={i} className="text-ink-2">
                {concern}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.affected_contracts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption uppercase tracking-[0.06em] text-ink-3">Contracts</span>
          {summary.affected_contracts.map((addr) => (
            <span key={addr} className="bg-bg-3 px-1.5 py-0.5 text-caption text-ink-2">
              {addr}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption uppercase tracking-[0.06em] text-ink-3">{term}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
