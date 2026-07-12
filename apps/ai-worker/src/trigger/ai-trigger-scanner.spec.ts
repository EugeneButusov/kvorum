import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiTriggerScanner } from './ai-trigger-scanner';
import { AI_SUMMARIZE_QUEUE } from '../queue/ai-queue-names';

function makeDeps(enabled: boolean, ids: string[]) {
  const send = vi.fn().mockResolvedValue('job-id');
  const port = { send, work: vi.fn(), getQueueStats: vi.fn(), getOldestJobAgeSeconds: vi.fn() };
  const config = { isEnabled: vi.fn().mockReturnValue(enabled) };
  const proposals = {
    findRecentlyTransitioned: vi.fn().mockResolvedValue(ids.map((id) => ({ id }))),
  };
  return { send, port, config, proposals };
}

describe('AiTriggerScanner', () => {
  afterEach(() => delete process.env['AI_SINGLETON_THROTTLE_SECONDS']);

  it('enqueues one summarize job per proposal with singleton dedup when enabled', async () => {
    process.env['AI_SINGLETON_THROTTLE_SECONDS'] = '120';
    const { send, port, config, proposals } = makeDeps(true, ['p1', 'p2']);
    const scanner = new AiTriggerScanner(port as never, config as never, proposals as never);

    const count = await scanner.run(600_000);

    expect(count).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      AI_SUMMARIZE_QUEUE,
      { feature: 'proposal_summarizer', entityRef: 'proposal:p1' },
      { singletonKey: 'proposal_summarizer:proposal:p1', singletonSeconds: 120 },
    );
  });

  it('enqueues nothing when the feature flag is off', async () => {
    const { send, port, config, proposals } = makeDeps(false, ['p1']);
    const scanner = new AiTriggerScanner(port as never, config as never, proposals as never);
    const count = await scanner.run(600_000);
    expect(count).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(proposals.findRecentlyTransitioned).not.toHaveBeenCalled();
  });

  it('does not count throttled (null) sends', async () => {
    const { send, port, config, proposals } = makeDeps(true, ['p1', 'p2']);
    send.mockResolvedValueOnce('job-id').mockResolvedValueOnce(null);
    const scanner = new AiTriggerScanner(port as never, config as never, proposals as never);
    const count = await scanner.run(600_000);
    expect(count).toBe(1);
  });
});
