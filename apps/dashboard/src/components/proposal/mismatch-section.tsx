import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';
import {
  toAiConfidence,
  toProvenance,
  type AiSection,
  type ProposalMismatch,
} from '@/lib/ai/panel';
import { cn } from '@/lib/utils';

/**
 * Mismatch analysis (§6.9 / §6.18) — the flagship calldata-vs-prose detector. `result` is the
 * dedicated /ai/mismatch fetch: the FULL analysis for any stored row, `coming-soon` when nothing
 * has been analysed (non-binding / undecoded / unprocessed / capped), or `failed` on a fetch error.
 * The output stays fenced in every state; on absence the reader is pointed at the decoded actions.
 */
export function MismatchSection({ result }: { result: AiSection<ProposalMismatch> }) {
  return (
    <Section number="03" title="Mismatch analysis">
      {result.state === 'ok' ? (
        <MismatchBody analysis={result.data} />
      ) : (
        <AIPanel
          state={result.state === 'failed' ? 'failed' : 'coming-soon'}
          label="Mismatch analysis by Kvorum"
          comingSoonLabel="A calldata-vs-description analysis"
          fallbackHref="#actions"
          fallbackLabel="Review the decoded actions"
        />
      )}
    </Section>
  );
}

// consistent → neutral; the discrepancy tiers escalate note → warn. `assessmentLabel` humanises the
// snake_case enum for display.
const ASSESSMENT: Record<string, { label: string; tone: string; border: string }> = {
  consistent: { label: 'Consistent', tone: 'text-ink-2', border: 'border-line-2' },
  minor_discrepancy: { label: 'Minor discrepancy', tone: 'text-note-ink', border: 'border-note' },
  material_discrepancy: {
    label: 'Material discrepancy',
    tone: 'text-warn-ink',
    border: 'border-warn',
  },
  severe_discrepancy: { label: 'Severe discrepancy', tone: 'text-warn-ink', border: 'border-warn' },
};

const SEVERITY_TONE: Record<string, string> = {
  high: 'text-warn-ink',
  medium: 'text-note-ink',
  low: 'text-ink-3',
};

function MismatchBody({ analysis }: { analysis: ProposalMismatch }) {
  const assessment = ASSESSMENT[analysis.overall_assessment] ?? {
    label: analysis.overall_assessment.replace(/_/g, ' '),
    tone: 'text-ink-2',
    border: 'border-line-2',
  };

  return (
    <AIPanel
      label="Mismatch analysis by Kvorum"
      confidence={toAiConfidence(analysis.confidence)}
      provenance={toProvenance(analysis._meta)}
      sourceHref="#actions"
      sourceLabel="Review the decoded actions"
    >
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            'inline-flex w-fit items-center gap-2 border-[1.5px] px-2.5 py-1 font-mono text-mono-body uppercase tracking-[0.06em]',
            assessment.border,
            assessment.tone,
          )}
        >
          {assessment.label}
        </div>

        <p className="text-body-lg text-ink">{analysis.reasoning}</p>

        {analysis.discrepancies.length > 0 && (
          <div className="flex flex-col gap-1.5 font-mono text-mono-body">
            <p className="text-caption uppercase tracking-[0.06em] text-ink-3">Discrepancies</p>
            <ul className="flex flex-col gap-2.5">
              {analysis.discrepancies.map((d, i) => (
                <li key={i} className="border-l-2 border-line-2 pl-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn('uppercase', SEVERITY_TONE[d.severity] ?? 'text-ink-3')}>
                      {d.severity}
                    </span>
                    <span className="text-ink-4">{d.type.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-0.5 text-ink-2">{d.description}</p>
                  {d.description_excerpt && (
                    <p className="mt-1 border-l-2 border-line-3 pl-2 text-caption italic text-ink-3">
                      “{d.description_excerpt}”
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AIPanel>
  );
}
