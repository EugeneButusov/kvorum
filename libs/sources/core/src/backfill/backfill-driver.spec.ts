import { describe, it, expect, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { RpcClient } from '@libs/chain';
import type { DaoSourceRepository } from '@libs/db';
import { BackfillDriver } from './backfill-driver';
import type { BackfillDriverDeps } from './backfill-driver';
import { BackfillAlreadyStartedError } from './backfill-already-started.error';
import { BackfillNotResumableError } from './backfill-not-resumable.error';

// ---- Fixtures ----

const DAO_SOURCE_ID = '00000000-0000-0000-0000-000000000001';
const CHAIN_ID = '0x1';
const HEAD_BLOCK = 20_000_000n;

const BASE_CHAIN_CONFIG = {
  chainId: CHAIN_ID,
  name: 'mainnet',
  reorgHorizon: 100,
  providers: [{ name: 'p', url: 'http://rpc', kind: 'http' as const, priority: 1 }],
};

const FILTER = { address: '0x' + 'aa'.repeat(20) };

function makeRpcClient(
  opts: {
    headBlock?: bigint;
    logsPerChunk?: unknown[];
  } = {},
): RpcClient {
  const head = opts.headBlock ?? HEAD_BLOCK;
  const logs = opts.logsPerChunk ?? [];
  return {
    send: vi.fn().mockImplementation((method: string) => {
      if (method === 'eth_blockNumber') return Promise.resolve('0x' + head.toString(16));
      if (method === 'eth_getLogs') return Promise.resolve(logs);
      return Promise.resolve(null);
    }),
    getHealth: vi.fn().mockReturnValue({ chainId: CHAIN_ID, providers: [] }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as RpcClient;
}

function makeDaoSourceRow(
  overrides: Partial<{
    backfill_started_at_block: string | null;
    backfill_head_block: string | null;
  }> = {},
) {
  return {
    id: DAO_SOURCE_ID,
    dao_id: 'dao-1',
    source_type: 'compound_governor' as const,
    source_config: {},
    active_from_block: null,
    backfill_started_at_block: null,
    backfill_head_block: null,
    primary_chain_id: CHAIN_ID,
    ...overrides,
  };
}

function makeRepo(row: ReturnType<typeof makeDaoSourceRow> | undefined = makeDaoSourceRow()) {
  const captureBackfillStart = vi.fn().mockResolvedValue(undefined);
  const updateBackfillHead = vi.fn().mockResolvedValue(undefined);
  const clearBackfillState = vi.fn().mockResolvedValue(undefined);
  const repo = {
    findByIdWithChain: vi.fn().mockResolvedValue(row),
    captureBackfillStart,
    updateBackfillHead,
    clearBackfillState,
    findBySourceType: vi.fn(),
    findAll: vi.fn(),
  } as unknown as DaoSourceRepository;
  return { repo, captureBackfillStart, updateBackfillHead, clearBackfillState };
}

function makeDeps(
  rpcClient: RpcClient,
  repo: DaoSourceRepository,
  overrides: Partial<BackfillDriverDeps> = {},
): BackfillDriverDeps {
  return {
    rpcClient,
    daoSourceRepo: repo,
    chainConfig: BASE_CHAIN_CONFIG,
    filter: FILTER,
    listenerFactory: (_classifier) => vi.fn().mockResolvedValue(undefined),
    logger: silentLogger,
    ...overrides,
  };
}

// ---- Tests ----

describe('BackfillDriver', () => {
  describe('fresh mode', () => {
    it('#1 — clears state, captures eth_blockNumber, completes', async () => {
      const { repo, clearBackfillState, captureBackfillStart, updateBackfillHead } = makeRepo();
      const rpc = makeRpcClient({ headBlock: 9_999n }); // small range so chunkSize=10_000 covers it in one chunk
      const driver = new BackfillDriver(makeDeps(rpc, repo));

      // fromBlock=0, toBlock=9_999 → one chunk
      const result = await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'fresh',
        fromBlock: 0n,
        chunkSize: 10_000,
      });

      expect(result.status).toBe('completed');
      expect(clearBackfillState).toHaveBeenCalledWith(DAO_SOURCE_ID);
      expect(captureBackfillStart).toHaveBeenCalledWith(DAO_SOURCE_ID, 9_999n);
      expect(updateBackfillHead).toHaveBeenCalledTimes(1);
    });

    it('#2 — throws BackfillAlreadyStartedError when checkpoint exists and no force', async () => {
      const { repo } = makeRepo(makeDaoSourceRow({ backfill_started_at_block: '19000000' }));
      const driver = new BackfillDriver(makeDeps(makeRpcClient(), repo));

      await expect(
        driver.run({ daoSourceId: DAO_SOURCE_ID, mode: 'fresh', fromBlock: 0n }),
      ).rejects.toThrow(BackfillAlreadyStartedError);
    });

    it('#3 — force=true: clears existing checkpoint and re-captures', async () => {
      const { repo, clearBackfillState, captureBackfillStart } = makeRepo(
        makeDaoSourceRow({ backfill_started_at_block: '19000000' }),
      );
      const rpc = makeRpcClient();
      const driver = new BackfillDriver(makeDeps(rpc, repo));

      const result = await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'fresh',
        fromBlock: 0n,
        force: true,
        chunkSize: 100_000_000,
      });

      expect(result.status).toBe('completed');
      expect(clearBackfillState).toHaveBeenCalledWith(DAO_SOURCE_ID);
      expect(captureBackfillStart).toHaveBeenCalledWith(DAO_SOURCE_ID, HEAD_BLOCK);
    });
  });

  describe('resume mode', () => {
    it('#4 — rehydrates head from DB, no eth_blockNumber call (ADR-027)', async () => {
      const startedHead = 19_000_000n;
      const { repo } = makeRepo(
        makeDaoSourceRow({ backfill_started_at_block: startedHead.toString() }),
      );
      const rpc = makeRpcClient({ headBlock: 22_000_000n }); // would be wrong if used

      const driver = new BackfillDriver(makeDeps(rpc, repo));
      const result = await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'resume',
        fromBlock: 0n,
        chunkSize: 100_000_000, // one chunk covers the full range
      });

      expect(result.status).toBe('completed');
      // eth_blockNumber must NOT have been called in resume mode
      const calls = (rpc.send as ReturnType<typeof vi.fn>).mock.calls as [string][];
      expect(calls.every(([m]) => m !== 'eth_blockNumber')).toBe(true);
    });

    it('#5 — resume with head_block: starts from head_block + 1', async () => {
      const { repo, updateBackfillHead } = makeRepo(
        makeDaoSourceRow({
          backfill_started_at_block: '20000000',
          backfill_head_block: '18500000',
        }),
      );
      const rpc = makeRpcClient();
      const driver = new BackfillDriver(makeDeps(rpc, repo));

      const result = await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'resume',
        fromBlock: 0n,
        chunkSize: 100_000_000,
      });

      expect(result.status).toBe('completed');
      // The single chunk covers [18_500_001..HEAD_BLOCK]; checkpoint is HEAD_BLOCK
      expect(updateBackfillHead).toHaveBeenCalledWith(DAO_SOURCE_ID, HEAD_BLOCK);
    });

    it('#6 — throws BackfillNotResumableError when backfill_started_at_block is null', async () => {
      const { repo } = makeRepo(); // backfill_started_at_block = null
      const driver = new BackfillDriver(makeDeps(makeRpcClient(), repo));

      await expect(
        driver.run({ daoSourceId: DAO_SOURCE_ID, mode: 'resume', fromBlock: 0n }),
      ).rejects.toThrow(BackfillNotResumableError);
    });
  });

  describe('classifier correctness (ADR-027 + ADR-046)', () => {
    it('#7 — classifier uses head − 2×reorgHorizon cutoff', async () => {
      const head = 20_000_000n;
      const reorgHorizon = 100;
      const expectedCutoff = head - BigInt(reorgHorizon) * 2n; // 19_999_800

      const capturedClassifiers: Array<(bn: bigint) => string> = [];
      const { repo } = makeRepo(makeDaoSourceRow({ backfill_started_at_block: head.toString() }));

      const driver = new BackfillDriver(
        makeDeps(makeRpcClient({ headBlock: head }), repo, {
          chainConfig: { ...BASE_CHAIN_CONFIG, reorgHorizon },
          listenerFactory: (classifier) => {
            capturedClassifiers.push(classifier);
            return vi.fn().mockResolvedValue(undefined);
          },
        }),
      );

      await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'resume',
        fromBlock: 0n,
        chunkSize: 100_000_000,
      });

      expect(capturedClassifiers).toHaveLength(1);
      const classify = capturedClassifiers[0]!;
      expect(classify(expectedCutoff)).toBe('confirmed'); // bn <= cutoff ⇒ confirmed
      expect(classify(expectedCutoff + 1n)).toBe('pending'); // bn > cutoff ⇒ pending
    });

    it('#8 — resume: cutoff is derived from DB head, not a live eth_blockNumber call', async () => {
      const dbHead = 19_000_000n;
      const capturedClassifiers: Array<(bn: bigint) => string> = [];

      const { repo } = makeRepo(makeDaoSourceRow({ backfill_started_at_block: dbHead.toString() }));

      // eth_blockNumber would return a different (later) block if called
      const rpc = makeRpcClient({ headBlock: 20_000_000n });
      const driver = new BackfillDriver(
        makeDeps(rpc, repo, {
          listenerFactory: (classifier) => {
            capturedClassifiers.push(classifier);
            return vi.fn().mockResolvedValue(undefined);
          },
        }),
      );

      await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'resume',
        fromBlock: 0n,
        chunkSize: 100_000_000,
      });

      const classify = capturedClassifiers[0]!;
      // cutoff = dbHead - 200 = 18_999_800
      const expectedCutoff = dbHead - 200n;
      expect(classify(expectedCutoff)).toBe('confirmed');
      expect(classify(expectedCutoff + 1n)).toBe('pending');
    });
  });

  describe('error handling', () => {
    it('#9 — listener error: returns error outcome, checkpoint not advanced for failed chunk', async () => {
      const { repo, updateBackfillHead } = makeRepo(
        makeDaoSourceRow({ backfill_started_at_block: HEAD_BLOCK.toString() }),
      );

      // Return a log so the listener is actually called
      const rawLog = {
        blockNumber: '0x1',
        blockHash: '0x' + 'cd'.repeat(32),
        transactionHash: '0x' + 'ab'.repeat(32),
        transactionIndex: '0x0',
        logIndex: '0x0',
        address: '0x' + 'aa'.repeat(20),
        topics: [],
        data: '0x',
        removed: false,
      };
      const rpc = makeRpcClient({ logsPerChunk: [rawLog] });

      const driver = new BackfillDriver(
        makeDeps(rpc, repo, {
          listenerFactory: () => async () => {
            throw new Error('CH write failure');
          },
        }),
      );

      const result = await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'resume',
        fromBlock: 0n,
        toBlock: 9_999n,
        chunkSize: 10_000,
      });

      expect(result.status).toBe('error');
      expect((result as { error: unknown }).error).toBeInstanceOf(Error);
      // Checkpoint must NOT be advanced for the failed chunk
      expect(updateBackfillHead).not.toHaveBeenCalled();
    });

    it('#10 — dao_source not found throws', async () => {
      // Build repo with findByIdWithChain returning undefined (row not found)
      const repo = {
        findByIdWithChain: vi.fn().mockResolvedValue(undefined),
        captureBackfillStart: vi.fn(),
        updateBackfillHead: vi.fn(),
        clearBackfillState: vi.fn(),
        findBySourceType: vi.fn(),
        findAll: vi.fn(),
      } as unknown as DaoSourceRepository;

      const driver = new BackfillDriver(makeDeps(makeRpcClient(), repo));

      await expect(
        driver.run({ daoSourceId: 'missing', mode: 'fresh', fromBlock: 0n }),
      ).rejects.toThrow('not found');
    });
  });

  describe('AbortSignal', () => {
    it('#11 — signal aborted before start: returns cancelled immediately', async () => {
      const controller = new AbortController();
      controller.abort();

      const { repo } = makeRepo(
        makeDaoSourceRow({ backfill_started_at_block: HEAD_BLOCK.toString() }),
      );

      const driver = new BackfillDriver(makeDeps(makeRpcClient(), repo));
      const result = await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'resume',
        fromBlock: 0n,
        toBlock: 9_999n,
        chunkSize: 10_000,
        signal: controller.signal,
      });

      expect(result.status).toBe('cancelled');
    });
  });

  describe('completion behaviour', () => {
    it('#12 — completed: checkpoint columns left populated (Q4 — finalize is I2)', async () => {
      const { repo, clearBackfillState } = makeRepo(
        makeDaoSourceRow({ backfill_started_at_block: HEAD_BLOCK.toString() }),
      );

      const driver = new BackfillDriver(makeDeps(makeRpcClient(), repo));
      const result = await driver.run({
        daoSourceId: DAO_SOURCE_ID,
        mode: 'resume',
        fromBlock: 0n,
        chunkSize: 100_000_000,
      });

      expect(result.status).toBe('completed');
      // clearBackfillState must NOT be called on natural completion
      expect(clearBackfillState).not.toHaveBeenCalled();
    });
  });
});
