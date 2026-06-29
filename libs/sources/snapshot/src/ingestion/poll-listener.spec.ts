import { describe, it, expect, vi } from 'vitest';
import type { PollPollContext } from '@sources/core';
import { makeSnapshotPollListener, SKIP_CAP } from './poll-listener';
import type { SnapshotClient } from '../client/client';
import type { SnapshotCursor } from '../domain/types';

function makeClient(proposals: unknown[], votes: unknown[]): SnapshotClient {
  return {
    fetchProposals: vi.fn().mockResolvedValue(proposals),
    fetchVotes: vi.fn().mockResolvedValue(votes),
  } as unknown as SnapshotClient;
}

const ctx: PollPollContext = {
  source: {
    daoSourceId: 'src-1',
    sourceType: 'snapshot',
    chainId: 'off-chain',
    sourceLabel: 'snapshot',
  },
  signal: new AbortController().signal,
};

describe('makeSnapshotPollListener', () => {
  it('starts both sub-cursors at createdGte=0/skip=0 on a null cursor', async () => {
    const client = makeClient([], []);
    const listener = makeSnapshotPollListener(
      { client, space: 'lido-snapshot.eth', pageSize: 2 },
      60_000,
    );
    await listener.poll(ctx, null);

    expect(client.fetchProposals).toHaveBeenCalledWith(
      expect.objectContaining({ space: 'lido-snapshot.eth', createdGte: 0, skip: 0, first: 2 }),
    );
    expect(client.fetchVotes).toHaveBeenCalledWith(
      expect.objectContaining({ space: 'lido-snapshot.eth', createdGte: 0, skip: 0, first: 2 }),
    );
  });

  it('maps proposals and votes to namespaced PollItems', async () => {
    const client = makeClient([{ id: '0xprop', created: 100 }], [{ id: '0xvote', created: 101 }]);
    const listener = makeSnapshotPollListener({ client, space: 's', pageSize: 2 }, 60_000);
    const { items } = await listener.poll(ctx, null);

    const prop = items.find((i) => i.eventType === 'SnapshotProposalCreated')!;
    expect(prop.externalId).toBe('prop:0xprop');
    expect(prop.ordinal).toBe('100');
    expect(prop.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prop.payload).toEqual({ id: '0xprop', created: 100 });

    const vote = items.find((i) => i.eventType === 'SnapshotVoteCast')!;
    expect(vote.externalId).toBe('vote:0xvote');
    expect(vote.ordinal).toBe('101');
  });

  it('proposal and vote external_ids never collide for a shared raw id', async () => {
    const client = makeClient([{ id: '0xsame', created: 1 }], [{ id: '0xsame', created: 1 }]);
    const listener = makeSnapshotPollListener({ client, space: 's', pageSize: 2 }, 60_000);
    const { items } = await listener.poll(ctx, null);
    const ids = items.map((i) => i.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('prop:0xsame');
    expect(ids).toContain('vote:0xsame');
  });

  it('advances skip within a window while pages are full', async () => {
    const client = makeClient(
      [
        { id: 'a', created: 10 },
        { id: 'b', created: 20 },
      ],
      [],
    );
    const listener = makeSnapshotPollListener({ client, space: 's', pageSize: 2 }, 60_000);
    const { nextCursor } = await listener.poll(ctx, null);
    const cur = nextCursor as unknown as SnapshotCursor;
    expect(cur.proposals).toEqual({ createdGte: 0, skip: 2 });
    // votes returned a short page → rolled forward (empty → stays at 0)
    expect(cur.votes).toEqual({ createdGte: 0, skip: 0 });
  });

  it('rolls createdGte forward and resets skip on a short page', async () => {
    const client = makeClient([{ id: 'a', created: 30 }], []); // pageSize 2, returned 1 → short
    const listener = makeSnapshotPollListener({ client, space: 's', pageSize: 2 }, 60_000);
    const start: SnapshotCursor = {
      proposals: { createdGte: 5, skip: 4 },
      votes: { createdGte: 0, skip: 0 },
    };
    const { nextCursor } = await listener.poll(ctx, start as unknown as never);
    const cur = nextCursor as unknown as SnapshotCursor;
    expect(cur.proposals).toEqual({ createdGte: 30, skip: 0 });
  });

  it('rolls createdGte forward when a full page would breach the skip cap', async () => {
    const client = makeClient(
      [
        { id: 'a', created: 40 },
        { id: 'b', created: 50 },
      ],
      [],
    );
    const listener = makeSnapshotPollListener({ client, space: 's', pageSize: 2 }, 60_000);
    const start: SnapshotCursor = {
      proposals: { createdGte: 5, skip: SKIP_CAP - 2 },
      votes: { createdGte: 0, skip: 0 },
    };
    const { nextCursor } = await listener.poll(ctx, start as unknown as never);
    const cur = nextCursor as unknown as SnapshotCursor;
    expect(cur.proposals).toEqual({ createdGte: 50, skip: 0 });
  });

  it('rolls to the max created across a short page even when rows are not ascending', async () => {
    // pageSize 3, two rows returned (short page → roll forward); the larger `created` is not last,
    // exercising the max-scan in both advance() and the high-water-mark computation.
    const client = makeClient(
      [
        { id: 'a', created: 80 },
        { id: 'b', created: 40 },
      ],
      [],
    );
    const listener = makeSnapshotPollListener({ client, space: 's', pageSize: 3 }, 60_000);
    const { nextCursor } = await listener.poll(ctx, null);
    const cur = nextCursor as unknown as SnapshotCursor;
    expect(cur.proposals).toEqual({ createdGte: 80, skip: 0 });
  });

  it('exposes the configured interval', () => {
    const listener = makeSnapshotPollListener({ client: makeClient([], []), space: 's' }, 45_000);
    expect(listener.intervalMs).toBe(45_000);
  });
});
