import { describe, expect, it, vi } from 'vitest';
import { TimestampFillerService } from './timestamp-filler.service';

describe('TimestampFillerService', () => {
  it('fills timestamps returned by eth_getBlockByNumber', async () => {
    const proposals = {
      findPendingTimestampFill: vi.fn().mockResolvedValue([
        {
          id: 'proposal-1',
          chain_id: '0x1',
          voting_starts_block: '10',
          voting_starts_at: null,
          voting_ends_block: '11',
          voting_ends_at: null,
        },
      ]),
      fillTimestamps: vi.fn().mockResolvedValue(undefined),
    };
    const registry = {
      peek: vi.fn().mockReturnValue({
        chainCfg: { chainId: '0x1' },
        client: {
          send: vi
            .fn()
            .mockResolvedValueOnce({ timestamp: '0x64' })
            .mockResolvedValueOnce({ timestamp: '0xc8' }),
        },
      }),
    };
    const filler = new TimestampFillerService(proposals as never, registry as never);

    await filler.tick();

    expect(proposals.fillTimestamps).toHaveBeenCalledWith([
      {
        id: 'proposal-1',
        voting_starts_at: new Date(100_000),
        voting_ends_at: new Date(200_000),
      },
    ]);
  });

  it('does not update when the requested block has not been mined yet', async () => {
    const proposals = {
      findPendingTimestampFill: vi.fn().mockResolvedValue([
        {
          id: 'proposal-1',
          chain_id: '0x1',
          voting_starts_block: '10',
          voting_starts_at: null,
          voting_ends_block: null,
          voting_ends_at: null,
        },
      ]),
      fillTimestamps: vi.fn(),
    };
    const registry = {
      peek: vi.fn().mockReturnValue({
        chainCfg: { chainId: '0x1' },
        client: { send: vi.fn().mockResolvedValue(null) },
      }),
    };
    const filler = new TimestampFillerService(proposals as never, registry as never);

    await filler.tick();

    expect(proposals.fillTimestamps).not.toHaveBeenCalled();
  });
});
