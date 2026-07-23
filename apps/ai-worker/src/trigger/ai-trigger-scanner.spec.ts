import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiTriggerScanner } from './ai-trigger-scanner';
import { AI_MISMATCH_QUEUE, AI_SUMMARIZE_QUEUE } from '../queue/ai-queue-names';

function makeDeps(
  o: {
    summarize?: boolean;
    mismatch?: boolean;
    disabled?: boolean;
    summaryIds?: string[];
    mismatchIds?: string[];
  } = {},
) {
  const send = vi.fn().mockResolvedValue('job-id');
  const port = { send, work: vi.fn(), getQueueStats: vi.fn(), getOldestJobAgeSeconds: vi.fn() };
  const config = {
    isEnabled: vi.fn((f: string) =>
      f === 'mismatch_detector' ? (o.mismatch ?? false) : (o.summarize ?? false),
    ),
  };
  const proposals = {
    findRecentlyTransitioned: vi.fn().mockResolvedValue((o.summaryIds ?? []).map((id) => ({ id }))),
  };
  const mismatchScan = {
    findCandidates: vi.fn().mockResolvedValue((o.mismatchIds ?? []).map((id) => ({ id }))),
  };
  const budgetState = { isDisabled: vi.fn().mockReturnValue(o.disabled ?? false) };
  const scanner = new AiTriggerScanner(
    port as never,
    config as never,
    proposals as never,
    budgetState as never,
    mismatchScan as never,
  );
  return { send, config, proposals, mismatchScan, budgetState, scanner };
}

describe('AiTriggerScanner', () => {
  afterEach(() => delete process.env['AI_SINGLETON_THROTTLE_SECONDS']);

  describe('proposal_summarizer', () => {
    it('enqueues one summarize job per proposal with singleton dedup when enabled', async () => {
      process.env['AI_SINGLETON_THROTTLE_SECONDS'] = '120';
      const { send, scanner } = makeDeps({ summarize: true, summaryIds: ['p1', 'p2'] });

      const count = await scanner.run(600_000);

      expect(count).toBe(2);
      expect(send).toHaveBeenCalledWith(
        AI_SUMMARIZE_QUEUE,
        { feature: 'proposal_summarizer', entityRef: 'proposal:p1' },
        { singletonKey: 'proposal_summarizer:proposal:p1', singletonSeconds: 120 },
      );
    });

    it('enqueues nothing when the flag is off', async () => {
      const { send, proposals, scanner } = makeDeps({ summarize: false, summaryIds: ['p1'] });
      expect(await scanner.run(600_000)).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(proposals.findRecentlyTransitioned).not.toHaveBeenCalled();
    });

    it('does not count throttled (null) sends', async () => {
      const { send, scanner } = makeDeps({ summarize: true, summaryIds: ['p1', 'p2'] });
      send.mockResolvedValueOnce('job-id').mockResolvedValueOnce(null);
      expect(await scanner.run(600_000)).toBe(1);
    });

    it('enqueues nothing when budget-disabled (even if enabled)', async () => {
      const { send, proposals, scanner } = makeDeps({
        summarize: true,
        summaryIds: ['p1'],
        disabled: true,
      });
      expect(await scanner.run(600_000)).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(proposals.findRecentlyTransitioned).not.toHaveBeenCalled();
    });
  });

  describe('mismatch_detector', () => {
    it('enqueues one mismatch job per all-decoded binding candidate when enabled', async () => {
      process.env['AI_SINGLETON_THROTTLE_SECONDS'] = '120';
      const { send, scanner } = makeDeps({ mismatch: true, mismatchIds: ['m1', 'm2'] });

      const count = await scanner.run(600_000);

      expect(count).toBe(2);
      expect(send).toHaveBeenCalledWith(
        AI_MISMATCH_QUEUE,
        { feature: 'mismatch_detector', entityRef: 'proposal:m1' },
        { singletonKey: 'mismatch_detector:proposal:m1', singletonSeconds: 120 },
      );
    });

    it('does not scan when the mismatch flag is off', async () => {
      const { mismatchScan, scanner } = makeDeps({ mismatch: false, mismatchIds: ['m1'] });
      await scanner.run(600_000);
      expect(mismatchScan.findCandidates).not.toHaveBeenCalled();
    });

    it('does not scan when the mismatch feature is budget-disabled', async () => {
      const { mismatchScan, scanner } = makeDeps({
        mismatch: true,
        mismatchIds: ['m1'],
        disabled: true,
      });
      await scanner.run(600_000);
      expect(mismatchScan.findCandidates).not.toHaveBeenCalled();
    });
  });
});
