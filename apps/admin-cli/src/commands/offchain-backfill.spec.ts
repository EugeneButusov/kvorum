import { describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '@libs/domain';
import type {
  PollItem,
  PollListener,
  PollResult,
  QueueProducerPort,
  SourceContext,
} from '@sources/core';
import { cursorsEqual, EnqueueOffChainProducer, runOffChainDrain } from './offchain-backfill.js';

const source: SourceContext = {
  daoSourceId: 'src-1',
  sourceType: 'snapshot' as never,
  chainId: 'off-chain',
  sourceLabel: 'snapshot' as never,
};

const opts = { quiescenceTicks: 3, interTickDelayMs: 0 };

function item(id: string): PollItem {
  return {
    externalId: id,
    eventType: 'snapshot_proposal_created' as never,
    contentHash: `h-${id}`,
    ordinal: '1',
    payload: {},
  };
}

/** A listener that replays a scripted sequence of poll results, one per tick. */
function scriptedListener(script: PollResult<JsonValue>[]): {
  listener: PollListener<JsonValue>;
  cursorsSeen: (JsonValue | null)[];
} {
  const cursorsSeen: (JsonValue | null)[] = [];
  let i = 0;
  return {
    cursorsSeen,
    listener: {
      intervalMs: 0,
      async poll(_ctx, cursor): Promise<PollResult<JsonValue>> {
        cursorsSeen.push(cursor);
        return script[Math.min(i++, script.length - 1)]!;
      },
    },
  };
}

function fakeProducer(initialCursor: JsonValue | null = null): {
  producer: QueueProducerPort;
  committed: PollItem[];
} {
  const committed: PollItem[] = [];
  return {
    committed,
    producer: {
      loadCursor: vi.fn().mockResolvedValue(initialCursor),
      commitTick: vi.fn(async (_s, items) => {
        committed.push(...items);
      }),
    },
  };
}

describe('cursorsEqual', () => {
  it('treats null and missing as equal, and compares structurally', () => {
    expect(cursorsEqual(null, null)).toBe(true);
    expect(cursorsEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(cursorsEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('runOffChainDrain', () => {
  it('drains until K consecutive empty + non-advancing ticks, then completes', async () => {
    // 2 productive ticks (advancing cursor), then a stable empty cursor forever.
    const { listener } = scriptedListener([
      { items: [item('a')], nextCursor: { skip: 1 } },
      { items: [item('b')], nextCursor: { skip: 2 } },
      { items: [], nextCursor: { skip: 2 } }, // quiescent #1
      { items: [], nextCursor: { skip: 2 } }, // quiescent #2
      { items: [], nextCursor: { skip: 2 } }, // quiescent #3 → stop
    ]);
    const { producer, committed } = fakeProducer();

    const outcome = await runOffChainDrain({
      source,
      listener,
      producer,
      options: opts,
      signal: new AbortController().signal,
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.ticks).toBe(5);
    expect(committed.map((i) => i.externalId)).toEqual(['a', 'b']);
  });

  it('resets the quiescence counter when a later tick still advances the cursor', async () => {
    const { listener } = scriptedListener([
      { items: [], nextCursor: { skip: 1 } }, // empty but ADVANCED → not quiescent
      { items: [], nextCursor: { skip: 1 } }, // quiescent #1
      { items: [], nextCursor: { skip: 1 } }, // quiescent #2
      { items: [], nextCursor: { skip: 1 } }, // quiescent #3 → stop
    ]);
    const { producer } = fakeProducer();

    const outcome = await runOffChainDrain({
      source,
      listener,
      producer,
      options: opts,
      signal: new AbortController().signal,
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.ticks).toBe(4);
  });

  it('treats a boundary re-read (items > 0 but cursor unchanged) as quiescent and stops', async () => {
    // The tip page keeps returning the same item at an unchanged cursor. Old logic reset quiescence
    // on any non-empty tick and looped forever; the drain must now terminate.
    const { listener } = scriptedListener([
      { items: [item('a')], nextCursor: { skip: 1 } }, // advances → not quiescent
      { items: [item('b')], nextCursor: { skip: 1 } }, // re-read, cursor unchanged → quiescent #1
      { items: [item('b')], nextCursor: { skip: 1 } }, // quiescent #2
      { items: [item('b')], nextCursor: { skip: 1 } }, // quiescent #3 → stop
    ]);
    const { producer } = fakeProducer();

    const outcome = await runOffChainDrain({
      source,
      listener,
      producer,
      options: opts,
      signal: new AbortController().signal,
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.ticks).toBe(4);
  });

  it('resumes from the persisted cursor on the first poll', async () => {
    const { listener, cursorsSeen } = scriptedListener([
      { items: [], nextCursor: { skip: 9 } },
      { items: [], nextCursor: { skip: 9 } },
      { items: [], nextCursor: { skip: 9 } },
    ]);
    const { producer } = fakeProducer({ skip: 9 });

    await runOffChainDrain({
      source,
      listener,
      producer,
      options: opts,
      signal: new AbortController().signal,
    });

    expect(cursorsSeen[0]).toEqual({ skip: 9 });
  });

  it('stops with status cancelled when the signal is aborted', async () => {
    const controller = new AbortController();
    const { listener } = scriptedListener([{ items: [item('a')], nextCursor: { skip: 1 } }]);
    const producer: QueueProducerPort = {
      loadCursor: vi.fn().mockResolvedValue(null),
      commitTick: vi.fn(async () => {
        controller.abort(); // abort after the first commit
      }),
    };

    const outcome = await runOffChainDrain({
      source,
      listener,
      producer,
      options: opts,
      signal: controller.signal,
    });

    expect(outcome.status).toBe('cancelled');
    expect(outcome.ticks).toBe(1);
  });
});

describe('EnqueueOffChainProducer', () => {
  it('rethrows a missing-queue error with a hint to use --direct', async () => {
    const boss = {
      send: vi.fn().mockRejectedValue(new Error('Queue off_chain_archive does not exist')),
    };
    const cursorRepo = { load: vi.fn(), upsert: vi.fn() };
    const producer = new EnqueueOffChainProducer(boss as never, cursorRepo as never);

    await expect(producer.commitTick(source, [item('a')], { skip: 1 })).rejects.toThrow(/--direct/);
    expect(cursorRepo.upsert).not.toHaveBeenCalled(); // cursor not advanced on failure
  });

  it('propagates unrelated send errors unchanged', async () => {
    const boss = { send: vi.fn().mockRejectedValue(new Error('connection reset')) };
    const cursorRepo = { load: vi.fn(), upsert: vi.fn() };
    const producer = new EnqueueOffChainProducer(boss as never, cursorRepo as never);

    await expect(producer.commitTick(source, [item('a')], { skip: 1 })).rejects.toThrow(
      'connection reset',
    );
  });
});
