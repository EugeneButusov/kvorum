import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiTriggerScanner, EMBED_STATES } from './ai-trigger-scanner';
import {
  AI_EMBED_QUEUE,
  AI_FORUM_SYNTHESIS_QUEUE,
  AI_MISMATCH_QUEUE,
  AI_SUMMARIZE_QUEUE,
} from '../queue/ai-queue-names';

function makeDeps(
  o: {
    summarize?: boolean;
    mismatch?: boolean;
    forum?: boolean;
    embed?: boolean;
    disabled?: boolean;
    summaryIds?: string[];
    mismatchIds?: string[];
    forumIds?: string[];
    closedForumIds?: string[];
  } = {},
) {
  const send = vi.fn().mockResolvedValue('job-id');
  const port = { send, work: vi.fn(), getQueueStats: vi.fn(), getOldestJobAgeSeconds: vi.fn() };
  const config = {
    isEnabled: vi.fn((f: string) => {
      if (f === 'mismatch_detector') return o.mismatch ?? false;
      if (f === 'forum_synthesizer') return o.forum ?? false;
      if (f === 'embedding') return o.embed ?? false;
      return o.summarize ?? false;
    }),
  };
  const proposals = {
    findRecentlyTransitioned: vi.fn().mockResolvedValue((o.summaryIds ?? []).map((id) => ({ id }))),
  };
  const mismatchScan = {
    findCandidates: vi.fn().mockResolvedValue((o.mismatchIds ?? []).map((id) => ({ id }))),
  };
  const forumThreads = {
    findSynthesisCandidates: vi.fn().mockResolvedValue((o.forumIds ?? []).map((id) => ({ id }))),
    findRecentlyClosedSynthesisCandidates: vi
      .fn()
      .mockResolvedValue((o.closedForumIds ?? []).map((id) => ({ id }))),
  };
  const budgetState = { isDisabled: vi.fn().mockReturnValue(o.disabled ?? false) };
  const scanner = new AiTriggerScanner(
    port as never,
    config as never,
    proposals as never,
    budgetState as never,
    mismatchScan as never,
    forumThreads as never,
  );
  return { send, config, proposals, mismatchScan, forumThreads, budgetState, scanner };
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

  describe('forum_synthesizer', () => {
    it('enqueues one synthesis job per candidate thread with singleton dedup when enabled', async () => {
      process.env['AI_SINGLETON_THROTTLE_SECONDS'] = '120';
      const { send, scanner } = makeDeps({ forum: true, forumIds: ['t1', 't2'] });

      const count = await scanner.run(600_000);

      expect(count).toBe(2);
      expect(send).toHaveBeenCalledWith(
        AI_FORUM_SYNTHESIS_QUEUE,
        { feature: 'forum_synthesizer', entityRef: 'forum_thread:t1' },
        { singletonKey: 'forum_synthesizer:forum_thread:t1', singletonSeconds: 120 },
      );
    });

    it('enqueues a final synthesis for a recently-closed proposal thread (once on close)', async () => {
      const { send, forumThreads, scanner } = makeDeps({
        forum: true,
        forumIds: [],
        closedForumIds: ['t3'],
      });

      const count = await scanner.run(600_000);

      expect(count).toBe(1);
      expect(forumThreads.findRecentlyClosedSynthesisCandidates).toHaveBeenCalledWith(
        ['succeeded', 'defeated', 'queued', 'executed', 'canceled', 'expired', 'vetoed'],
        expect.any(Date),
        expect.any(Number),
      );
      expect(send).toHaveBeenCalledWith(
        AI_FORUM_SYNTHESIS_QUEUE,
        { feature: 'forum_synthesizer', entityRef: 'forum_thread:t3' },
        expect.objectContaining({ singletonKey: 'forum_synthesizer:forum_thread:t3' }),
      );
    });

    it('enqueues a thread matching both the active and closed lists only once', async () => {
      const { send, scanner } = makeDeps({
        forum: true,
        forumIds: ['t1'],
        closedForumIds: ['t1'],
      });

      const count = await scanner.run(600_000);

      expect(count).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('does not scan when the forum flag is off', async () => {
      const { forumThreads, scanner } = makeDeps({ forum: false, forumIds: ['t1'] });
      await scanner.run(600_000);
      expect(forumThreads.findSynthesisCandidates).not.toHaveBeenCalled();
      expect(forumThreads.findRecentlyClosedSynthesisCandidates).not.toHaveBeenCalled();
    });

    it('does not scan when the forum feature is budget-disabled', async () => {
      const { forumThreads, scanner } = makeDeps({ forum: true, forumIds: ['t1'], disabled: true });
      await scanner.run(600_000);
      expect(forumThreads.findSynthesisCandidates).not.toHaveBeenCalled();
    });
  });

  describe('embedding', () => {
    it('enqueues one embed job per above-pending recently-transitioned proposal', async () => {
      process.env['AI_SINGLETON_THROTTLE_SECONDS'] = '120';
      const { send, proposals, scanner } = makeDeps({ embed: true, summaryIds: ['e1', 'e2'] });

      const count = await scanner.run(600_000);

      expect(count).toBe(2);
      expect(proposals.findRecentlyTransitioned).toHaveBeenCalledWith(
        EMBED_STATES,
        expect.any(Date),
      );
      expect(send).toHaveBeenCalledWith(
        AI_EMBED_QUEUE,
        { feature: 'embedding', entityRef: 'proposal:e1' },
        { singletonKey: 'embedding:proposal:e1', singletonSeconds: 120 },
      );
    });

    it('does not scan when the embedding flag is off', async () => {
      const { proposals, scanner } = makeDeps({ embed: false, summaryIds: ['e1'] });
      await scanner.run(600_000);
      expect(proposals.findRecentlyTransitioned).not.toHaveBeenCalled();
    });

    it('does not scan when the embedding feature is budget-disabled', async () => {
      const { proposals, scanner } = makeDeps({ embed: true, summaryIds: ['e1'], disabled: true });
      await scanner.run(600_000);
      expect(proposals.findRecentlyTransitioned).not.toHaveBeenCalled();
    });
  });
});
