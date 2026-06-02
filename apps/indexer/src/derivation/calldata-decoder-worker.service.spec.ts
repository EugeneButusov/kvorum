import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DecodeResult } from '@sources/core';

vi.mock('./calldata-decode-metrics', () => ({
  calldataDecodeMetrics: {
    outcomes: { add: vi.fn() },
    tickDurationSeconds: { record: vi.fn() },
    abiDecodeSuccessRate: { record: vi.fn() },
  },
}));

import { calldataDecodeMetrics } from './calldata-decode-metrics';
import { CalldataDecoderWorkerService } from './calldata-decoder-worker.service';

const ROW = {
  id: 'action-1',
  proposal_id: 'proposal-1',
  target_address: '0x' + 'a'.repeat(40),
  target_chain_id: '0x1',
  source_type: 'compound_governor_bravo',
  function_signature: null as string | null,
  calldata: '0xa9059cbb' + '0'.repeat(128),
  decode_attempt_count: 0,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function makeActions(firstBatch: (typeof ROW)[] = [ROW]) {
  return {
    findPendingDecodeForUpdate: vi.fn().mockResolvedValueOnce(firstBatch).mockResolvedValue([]),
    markDecoded: vi.fn().mockResolvedValue(undefined),
    markUndecodable: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDecoder(result: DecodeResult) {
  return { decode: vi.fn().mockResolvedValue(result) };
}

/** Fake pgDb: execute calls the callback synchronously with an empty trx object. */
function makePgDb() {
  return {
    transaction: vi.fn().mockReturnValue({
      execute: vi.fn().mockImplementation((cb: (trx: unknown) => unknown) => cb({})),
    }),
  };
}

function makeWorker(
  actions = makeActions([]),
  decoder: { decode: ReturnType<typeof vi.fn> } = makeDecoder({ kind: 'miss' }),
  pgDb = makePgDb(),
) {
  return new CalldataDecoderWorkerService(pgDb as never, actions as never, decoder as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CalldataDecoderWorkerService', () => {
  it('#1 — onApplicationBootstrap fires one tick immediately', async () => {
    const actions = makeActions([]);
    const worker = makeWorker(actions);

    await worker.onApplicationBootstrap();

    expect(actions.findPendingDecodeForUpdate).toHaveBeenCalledTimes(1);
  });

  it('#2 — inFlight guard: second concurrent tick is a no-op', async () => {
    // First tick suspends at the first await inside the transaction callback,
    // setting inFlight = true before yielding. Second tick sees inFlight and returns.
    const actions = makeActions([]);
    const worker = makeWorker(actions);

    const p1 = worker.tick();
    const p2 = worker.tick(); // inFlight = true at this point
    await Promise.all([p1, p2]);

    expect(actions.findPendingDecodeForUpdate).toHaveBeenCalledTimes(1);
  });

  it('#3 — no pending rows: loop exits cleanly, no marks called', async () => {
    const actions = makeActions([]);
    const worker = makeWorker(actions);

    await worker.tick();

    expect(actions.markDecoded).not.toHaveBeenCalled();
    expect(actions.markUndecodable).not.toHaveBeenCalled();
    expect(calldataDecodeMetrics.outcomes.add).not.toHaveBeenCalled();
  });

  it('#4 — decoded result: markDecoded called with correct args; outcome metric recorded', async () => {
    const result: DecodeResult = {
      kind: 'decoded',
      decodedFunction: 'transfer(address,uint256)',
      decodedArguments: { to: '0xabc', amount: '1000' },
      source: 'bundled_library',
    };
    const actions = makeActions();
    const worker = makeWorker(actions, makeDecoder(result));

    await worker.tick();

    expect(actions.markDecoded).toHaveBeenCalledWith({}, ROW.id, {
      function: 'transfer(address,uint256)',
      arguments: { to: '0xabc', amount: '1000' },
    });
    expect(actions.markUndecodable).not.toHaveBeenCalled();
    expect(calldataDecodeMetrics.outcomes.add).toHaveBeenCalledWith(1, {
      outcome: 'decoded',
      source: 'bundled_library',
    });
  });

  it('#5 — partial result: markUndecodable with functionSignatureGuess; source=selector_index', async () => {
    const result: DecodeResult = {
      kind: 'partial',
      decodedFunction: null,
      functionSignatureGuess: 'transfer(address,uint256)',
      source: 'selector_index',
    };
    const actions = makeActions();
    const worker = makeWorker(actions, makeDecoder(result));

    await worker.tick();

    expect(actions.markUndecodable).toHaveBeenCalledWith(
      {},
      ROW.id,
      expect.objectContaining({
        functionSignatureGuess: 'transfer(address,uint256)',
        retryAt: expect.any(Date),
      }),
    );
    expect(actions.markDecoded).not.toHaveBeenCalled();
    expect(calldataDecodeMetrics.outcomes.add).toHaveBeenCalledWith(1, {
      outcome: 'partial',
      source: 'selector_index',
    });
  });

  it('#6 — miss result: markUndecodable without guess; outcome=miss metric recorded', async () => {
    const actions = makeActions();
    const worker = makeWorker(actions, makeDecoder({ kind: 'miss' }));

    await worker.tick();

    const call = vi.mocked(actions.markUndecodable).mock.calls[0]!;
    expect(call[1]).toBe(ROW.id);
    expect(call[2]).not.toHaveProperty('functionSignatureGuess');
    expect(call[2]).toMatchObject({ retryAt: expect.any(Date) });
    expect(actions.markDecoded).not.toHaveBeenCalled();
    expect(calldataDecodeMetrics.outcomes.add).toHaveBeenCalledWith(1, { outcome: 'miss' });
  });

  it('#7 — decoder throws: falls back to miss path, markUndecodable still called', async () => {
    const actions = makeActions();
    const crashingDecoder = { decode: vi.fn().mockRejectedValue(new Error('decode crash')) };
    const worker = makeWorker(actions, crashingDecoder as never);

    await worker.tick();

    expect(actions.markUndecodable).toHaveBeenCalledWith(
      {},
      ROW.id,
      expect.objectContaining({ retryAt: expect.any(Date) }),
    );
    expect(actions.markDecoded).not.toHaveBeenCalled();
  });

  it('#8a — passes row.source_type into the decoder input', async () => {
    const actions = makeActions();
    const decoder = makeDecoder({ kind: 'miss' });
    const worker = makeWorker(actions, decoder);

    await worker.tick();

    expect(decoder.decode).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: ROW.target_chain_id,
        sourceType: ROW.source_type,
        targetAddress: ROW.target_address,
      }),
    );
  });

  it('#8 — outer error (transaction rejects): tick resolves, inFlight resets, metric recorded', async () => {
    const badDb = {
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('db down')),
      }),
    };
    const worker = makeWorker(makeActions(), makeDecoder({ kind: 'miss' }), badDb);

    await expect(worker.tick()).resolves.toBeUndefined();
    expect(calldataDecodeMetrics.tickDurationSeconds.record).toHaveBeenCalledTimes(1);

    // inFlight must be reset so a subsequent tick can run
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(badDb.transaction).toHaveBeenCalledTimes(2);
  });

  it('#9 — success rate gauge recorded after a tick with mixed outcomes', async () => {
    // Two rows: first decoded, second miss
    const actions = {
      findPendingDecodeForUpdate: vi
        .fn()
        .mockResolvedValueOnce([ROW])
        .mockResolvedValueOnce([{ ...ROW, id: 'action-2' }])
        .mockResolvedValue([]),
      markDecoded: vi.fn().mockResolvedValue(undefined),
      markUndecodable: vi.fn().mockResolvedValue(undefined),
    };
    const decoder = {
      decode: vi
        .fn()
        .mockResolvedValueOnce({
          kind: 'decoded',
          decodedFunction: 'transfer(address,uint256)',
          decodedArguments: {},
          source: 'bundled_library',
        } satisfies DecodeResult)
        .mockResolvedValueOnce({ kind: 'miss' } satisfies DecodeResult),
    };
    const worker = makeWorker(actions as never, decoder as never);

    await worker.tick();

    // 1 decoded out of 2 total → 0.5
    expect(calldataDecodeMetrics.abiDecodeSuccessRate.record).toHaveBeenCalledOnce();
    expect(calldataDecodeMetrics.abiDecodeSuccessRate.record).toHaveBeenCalledWith(0.5);
  });

  it('#10 — success rate gauge not recorded when no rows processed', async () => {
    const worker = makeWorker(makeActions([]));

    await worker.tick();

    expect(calldataDecodeMetrics.abiDecodeSuccessRate.record).not.toHaveBeenCalled();
  });
});
