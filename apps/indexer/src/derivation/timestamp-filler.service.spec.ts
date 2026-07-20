import { describe, expect, it, vi } from 'vitest';
import { TimestampFillerService } from './timestamp-filler.service';

vi.mock('./derivation-metrics', () => ({
  derivationMetrics: {
    lagSeconds: { record: vi.fn() },
    processed: { add: vi.fn() },
    tickDurationSeconds: { record: vi.fn() },
    batchLookupSeconds: { record: vi.fn() },
    chWriteSeconds: { record: vi.fn() },
    timestampFill: { add: vi.fn() },
    timestampFillBacklog: { record: vi.fn() },
  },
}));

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
        headTracker: { getLastHead: () => null },
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

  it('logs warn and returns null when RPC call throws', async () => {
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
        headTracker: { getLastHead: () => null },
        chainCfg: { chainId: '0x1' },
        client: { send: vi.fn().mockRejectedValue(new Error('rpc down')) },
      }),
    };
    const filler = new TimestampFillerService(proposals as never, registry as never);

    await expect(filler.tick()).resolves.toBeUndefined();
    expect(proposals.fillTimestamps).not.toHaveBeenCalled();
  });

  it('returns null for block with non-string timestamp field', async () => {
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
        headTracker: { getLastHead: () => null },
        chainCfg: { chainId: '0x1' },
        client: { send: vi.fn().mockResolvedValue({ timestamp: 100 }) }, // number, not string
      }),
    };
    const filler = new TimestampFillerService(proposals as never, registry as never);

    await filler.tick();

    expect(proposals.fillTimestamps).not.toHaveBeenCalled();
  });

  it('onApplicationBootstrap fires the initial tick', async () => {
    const proposals = {
      findPendingTimestampFill: vi.fn().mockResolvedValue([]),
      fillTimestamps: vi.fn(),
    };
    const registry = {
      peek: vi.fn().mockReturnValue(undefined),
    };
    const filler = new TimestampFillerService(proposals as never, registry as never);
    // Should not throw — just fires void this.tick()
    await expect(filler.onApplicationBootstrap()).resolves.toBeUndefined();
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
        headTracker: { getLastHead: () => null },
        chainCfg: { chainId: '0x1' },
        client: { send: vi.fn().mockResolvedValue(null) },
      }),
    };
    const filler = new TimestampFillerService(proposals as never, registry as never);

    await filler.tick();

    expect(proposals.fillTimestamps).not.toHaveBeenCalled();
  });

  it('does not call the RPC for blocks that are not mined yet', async () => {
    const proposals = {
      findPendingTimestampFill: vi.fn().mockResolvedValue([
        {
          id: 'proposal-1',
          chain_id: '0x1',
          // Both blocks sit above the head — a proposal still inside its voting delay.
          voting_starts_block: '200',
          voting_starts_at: null,
          voting_ends_block: '300',
          voting_ends_at: null,
        },
      ]),
      fillTimestamps: vi.fn(),
    };
    const send = vi.fn();
    const registry = {
      peek: vi.fn().mockReturnValue({
        headTracker: { getLastHead: () => ({ blockNumber: 100n }) },
        chainCfg: { chainId: '0x1' },
        client: { send },
      }),
    };
    const filler = new TimestampFillerService(proposals as never, registry as never);

    await filler.tick();

    expect(send).not.toHaveBeenCalled();
    expect(proposals.fillTimestamps).not.toHaveBeenCalled();
  });

  it('fetches only the block at or below the head when the window straddles it', async () => {
    const proposals = {
      findPendingTimestampFill: vi.fn().mockResolvedValue([
        {
          id: 'proposal-1',
          // Voting has started but not ended: the start block is mined, the end block is not.
          voting_starts_block: '100',
          voting_starts_at: null,
          voting_ends_block: '300',
          voting_ends_at: null,
          chain_id: '0x1',
        },
      ]),
      fillTimestamps: vi.fn().mockResolvedValue(undefined),
    };
    const send = vi.fn().mockResolvedValue({ timestamp: '0x64' });
    const registry = {
      peek: vi.fn().mockReturnValue({
        headTracker: { getLastHead: () => ({ blockNumber: 100n }) },
        chainCfg: { chainId: '0x1' },
        client: { send },
      }),
    };
    const filler = new TimestampFillerService(proposals as never, registry as never);

    await filler.tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('eth_getBlockByNumber', ['0x64', false]);
    expect(proposals.fillTimestamps).toHaveBeenCalledWith([
      { id: 'proposal-1', voting_starts_at: new Date(100_000), voting_ends_at: null },
    ]);
  });
});
