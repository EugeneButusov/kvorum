process.env['OTEL_SERVICE_NAME'] ??= 'ai-worker';
process.env['OTEL_SERVICE_NAMESPACE'] ??= 'test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiBudgetCapService } from './ai-budget-cap.service';
import { AiBudgetState } from './ai-budget-state';
import { AiFeatureHandlerRegistry } from '../consumer/ai-feature-handler.registry';
import { AiJobConsumer } from '../consumer/ai-job.consumer';
import { aiMetrics } from '../metrics/ai-metrics';
import { AI_SUMMARIZE_QUEUE } from '../queue/ai-queue-names';
import type { AiJob } from '../queue/ai-queue-names';
import { AiTriggerScanner } from '../trigger/ai-trigger-scanner';

// AC #4 (SPEC §10.7 / §5.3, ADR-079). The individual enforcement points are unit-tested in isolation
// (ai-budget-cap.service.spec, ai-trigger-scanner.spec, ai-job.consumer.spec). This is the *cohesive*
// acceptance proof M5-7.2 asks for: deliberately lower a cap below a feature's month-to-date spend, then
// confirm the disable is honoured across ALL THREE observables — status data (the ai_worker_feature_disabled
// gauge + AiBudgetState), reject-at-enqueue (the trigger scanner), and worker-skip (the consumer) — over ONE
// shared AiBudgetState, exactly as the three collaborators share it in production. Then raise the cap and
// confirm the feature re-enables on the next tick (manual-raise-as-config), and that prior-month spend is
// excluded from the window (monthly reset). Pure-unit (no DATABASE_URL); the real-SQL month boundary is
// covered by the describeWithDb block in ai-budget-cap.service.spec.ts.

type WithTick = { tick(): Promise<void> };
type WithHandle = { handle(job: AiJob): Promise<void> };

/** A cost repo backed by an in-memory ledger that honours `since` exactly like the real SQL
 *  `WHERE timestamp >= since` — so month-to-date summing and monthly reset are both faithful. */
function makeCostRepo(rows: { feature: string; timestamp: Date; cost: number }[]) {
  return {
    sumCostForFeatureSince: vi.fn(async (feature: string, since: Date) =>
      rows
        .filter((r) => r.feature === feature && r.timestamp >= since)
        .reduce((sum, r) => sum + r.cost, 0),
    ),
  };
}

/** Compose the real cap service + trigger scanner + consumer around ONE shared AiBudgetState, with fake
 *  I/O ports. `summaryIds` are the summarize candidates the scanner would enqueue when the feature is live. */
function makeHarness(opts: {
  rows: { feature: string; timestamp: Date; cost: number }[];
  summaryIds?: string[];
}) {
  const state = new AiBudgetState();
  const cap = new AiBudgetCapService(
    makeCostRepo(opts.rows) as never,
    state,
  ) as unknown as WithTick;

  const send = vi.fn().mockResolvedValue('job-id');
  const port = { send, work: vi.fn(), getQueueStats: vi.fn(), getOldestJobAgeSeconds: vi.fn() };
  // Only proposal_summarizer is enabled, so the drill isolates one feature end-to-end.
  const config = { isEnabled: (f: string) => f === 'proposal_summarizer' };
  const proposals = {
    findRecentlyTransitioned: vi
      .fn()
      .mockResolvedValue((opts.summaryIds ?? []).map((id) => ({ id }))),
  };
  const mismatchScan = { findCandidates: vi.fn().mockResolvedValue([]) };
  const forumThreads = {
    findSynthesisCandidates: vi.fn().mockResolvedValue([]),
    findRecentlyClosedSynthesisCandidates: vi.fn().mockResolvedValue([]),
  };
  const scanner = new AiTriggerScanner(
    port as never,
    config as never,
    proposals as never,
    state,
    mismatchScan as never,
    forumThreads as never,
  );

  const registry = new AiFeatureHandlerRegistry();
  const handler = { handle: vi.fn().mockResolvedValue(undefined) };
  registry.register('proposal_summarizer', handler);
  const consumer = new AiJobConsumer(port as never, registry, state) as unknown as WithHandle;

  return { state, cap, scanner, consumer, send, proposals, handler };
}

const firstOfThisMonth = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
const midLastMonth = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));

describe('budget cap acceptance (AC #4) — deliberate cap-lower disables a feature everywhere', () => {
  afterEach(() => {
    delete process.env['AI_CAP_SUMMARIZE_USD'];
    vi.restoreAllMocks();
  });

  it('lowering the cap below spend disables enqueue + worker + status data; raising it re-enables', async () => {
    const { state, cap, scanner, consumer, send, proposals, handler } = makeHarness({
      rows: [{ feature: 'proposal_summarizer', timestamp: firstOfThisMonth(new Date()), cost: 2 }],
      summaryIds: ['p1'],
    });
    const disabledGauge = vi.spyOn(aiMetrics.featureDisabled, 'record');
    const jobsCounter = vi.spyOn(aiMetrics.jobsTotal, 'add');
    const job: AiJob = { feature: 'proposal_summarizer', entityRef: 'proposal:p1' };

    // Deliberately lower the cap ($1) below month-to-date spend ($2) → disabled on the next tick.
    process.env['AI_CAP_SUMMARIZE_USD'] = '1';
    await cap.tick();

    // (1) Status data: the shared state flips and the gauge records 1.
    expect(state.isDisabled('proposal_summarizer')).toBe(true);
    expect(disabledGauge).toHaveBeenCalledWith(1, { feature: 'proposal_summarizer' });

    // (2) Reject-at-enqueue: the scanner enqueues nothing and never even runs the candidate query.
    expect(await scanner.run(600_000)).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(proposals.findRecentlyTransitioned).not.toHaveBeenCalled();

    // (3) Worker-skip: a job that slipped through is skipped (not dispatched) and counted.
    await consumer.handle(job);
    expect(handler.handle).not.toHaveBeenCalled();
    expect(jobsCounter).toHaveBeenCalledWith(1, {
      feature: 'proposal_summarizer',
      outcome: 'skipped_budget_disabled',
    });

    // Manual-raise-as-config: raise the cap ($10) above spend → re-enabled on the next tick (per-tick env read).
    process.env['AI_CAP_SUMMARIZE_USD'] = '10';
    await cap.tick();
    expect(state.isDisabled('proposal_summarizer')).toBe(false);

    // Enqueue + processing resume once re-enabled.
    expect(await scanner.run(600_000)).toBe(1);
    expect(send).toHaveBeenCalledWith(AI_SUMMARIZE_QUEUE, job, expect.anything());
    await consumer.handle(job);
    expect(handler.handle).toHaveBeenCalledWith(job);
  });

  it('excludes prior-month spend from the current-month window (monthly reset)', async () => {
    const now = new Date();
    const { state, cap } = makeHarness({
      rows: [
        // Last month blew way past the cap — but a new calendar month must start clean.
        { feature: 'proposal_summarizer', timestamp: midLastMonth(now), cost: 50 },
        { feature: 'proposal_summarizer', timestamp: firstOfThisMonth(now), cost: 0.5 },
      ],
    });

    process.env['AI_CAP_SUMMARIZE_USD'] = '5'; // default cap
    await cap.tick();

    // Only this month's $0.50 counts (the service windows on startOfCurrentMonthUtc) → under cap → live.
    expect(state.isDisabled('proposal_summarizer')).toBe(false);
    expect(state.get('proposal_summarizer')?.spendUsd).toBeCloseTo(0.5);
  });
});
