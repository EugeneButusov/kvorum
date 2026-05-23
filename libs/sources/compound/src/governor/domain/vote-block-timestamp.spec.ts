import { describe, expect, it, vi } from 'vitest';
import { VoteBlockTimestampFetcher } from './vote-block-timestamp';

describe('VoteBlockTimestampFetcher', () => {
  it('fetches missing block timestamps and returns a per-block map', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ hash: '0xaaa', number: '0x64', timestamp: '0x64' })
      .mockResolvedValueOnce({ hash: '0xbbb', number: '0x65', timestamp: '0x65' });
    const fetcher = new VoteBlockTimestampFetcher();

    const result = await fetcher.fetchBatch(
      { client: { send } as never, chainCfg: { chainId: '0x1' } as never },
      [
        { blockNumber: '100', blockHash: '0xaaa' },
        { blockNumber: '101', blockHash: '0xbbb' },
      ],
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.get(fetcher.resultKey('100', '0xaaa'))?.toISOString()).toBe(
      '1970-01-01T00:01:40.000Z',
    );
    expect(result.get(fetcher.resultKey('101', '0xbbb'))?.toISOString()).toBe(
      '1970-01-01T00:01:41.000Z',
    );
  });

  it('reuses cached values for repeated block hashes', async () => {
    const send = vi.fn().mockResolvedValue({ hash: '0xaaa', number: '0x64', timestamp: '0x64' });
    const fetcher = new VoteBlockTimestampFetcher();

    await fetcher.fetchBatch({ client: { send } as never, chainCfg: { chainId: '0x1' } as never }, [
      { blockNumber: '100', blockHash: '0xaaa' },
    ]);
    await fetcher.fetchBatch({ client: { send } as never, chainCfg: { chainId: '0x1' } as never }, [
      { blockNumber: '100', blockHash: '0xaaa' },
    ]);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('drops mismatched hash/number RPC responses', async () => {
    const send = vi.fn().mockResolvedValue({ hash: '0xaaa', number: '0x66', timestamp: '0x66' });
    const fetcher = new VoteBlockTimestampFetcher();

    const result = await fetcher.fetchBatch(
      { client: { send } as never, chainCfg: { chainId: '0x1' } as never },
      [{ blockNumber: '100', blockHash: '0xaaa' }],
    );

    expect(result.get(fetcher.resultKey('100', '0xaaa'))).toBeUndefined();
  });
});
