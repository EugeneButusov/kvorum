import { describe, expect, it } from 'vitest';
import { buildCostReport } from './ai-cost.js';
import { resolveRegenerateTarget } from './ai.js';

describe('resolveRegenerateTarget', () => {
  it('maps a forum synthesizer entity to its queue with the force flag', () => {
    expect(resolveRegenerateTarget('forum_synthesizer', 'forum_thread:abc-123', true)).toEqual({
      queue: 'ai_forum_synthesis',
      job: { feature: 'forum_synthesizer', entityRef: 'forum_thread:abc-123', force: true },
    });
  });

  it('defaults force to false and maps other known features', () => {
    expect(resolveRegenerateTarget('proposal_summarizer', 'proposal:p1', false)).toEqual({
      queue: 'ai_summarize',
      job: { feature: 'proposal_summarizer', entityRef: 'proposal:p1', force: false },
    });
  });

  it('rejects an unknown feature', () => {
    const out = resolveRegenerateTarget('nope', 'forum_thread:x', false);
    expect('error' in out && out.error).toMatch(/unknown AI feature/);
  });

  it('rejects a malformed entity_reference', () => {
    const out = resolveRegenerateTarget('forum_synthesizer', 'no-colon', false);
    expect('error' in out && out.error).toMatch(/invalid entity_reference/);
  });
});

describe('buildCostReport', () => {
  const since = new Date('2026-08-01T00:00:00Z');

  it('computes utilization %, disabled at >= cap, and totals', () => {
    const report = buildCostReport(
      [
        { feature: 'proposal_summarizer', spendUsd: 2.5, capUsd: 5 },
        { feature: 'mismatch_detector', spendUsd: 20, capUsd: 20 }, // exactly at cap → disabled
        { feature: 'forum_synthesizer', spendUsd: 0, capUsd: 15 },
        { feature: 'embedding', spendUsd: 0.5, capUsd: 1 },
      ],
      since,
    );
    expect(report.since).toBe('2026-08-01T00:00:00.000Z');
    const byFeature = Object.fromEntries(report.perFeature.map((r) => [r.feature, r]));
    expect(byFeature['proposal_summarizer']).toMatchObject({ utilizationPct: 50, disabled: false });
    expect(byFeature['mismatch_detector']).toMatchObject({ utilizationPct: 100, disabled: true });
    expect(byFeature['forum_synthesizer']).toMatchObject({ utilizationPct: 0, disabled: false });
    expect(report.totalSpendUsd).toBeCloseTo(23);
    expect(report.ceilingUsd).toBe(41);
  });

  it('treats an empty ledger as zero spend, nothing disabled', () => {
    const report = buildCostReport([{ feature: 'embedding', spendUsd: 0, capUsd: 1 }], since);
    expect(report.perFeature[0]).toMatchObject({ spendUsd: 0, utilizationPct: 0, disabled: false });
    expect(report.totalSpendUsd).toBe(0);
  });
});
