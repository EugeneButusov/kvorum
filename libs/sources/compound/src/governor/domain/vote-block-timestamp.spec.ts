import { describe, expect, it, vi } from 'vitest';
import { VoteBlockTimestampFetcher } from './vote-block-timestamp';

describe('VoteBlockTimestampFetcher', () => {
  it('fetches missing block timestamps and returns a per-block map', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ timestamp: '0x64' })
      .mockResolvedValueOnce({ timestamp: '0x65' });
    const fetcher = new VoteBlockTimestampFetcher();

    const result = await fetcher.fetchBatch(
      { client: { send } as never, chainCfg: { chainId: '0x1' } as never },
      ['100', '101'],
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.get('100')?.toISOString()).toBe('1970-01-01T00:01:40.000Z');
    expect(result.get('101')?.toISOString()).toBe('1970-01-01T00:01:41.000Z');
  });

  it('reuses cached values for repeated block numbers', async () => {
    const send = vi.fn().mockResolvedValue({ timestamp: '0x64' });
    const fetcher = new VoteBlockTimestampFetcher();

    await fetcher.fetchBatch({ client: { send } as never, chainCfg: { chainId: '0x1' } as never }, [
      '100',
    ]);
    await fetcher.fetchBatch({ client: { send } as never, chainCfg: { chainId: '0x1' } as never }, [
      '100',
    ]);

    expect(send).toHaveBeenCalledTimes(1);
  });
});
