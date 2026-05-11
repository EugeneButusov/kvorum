import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CompoundGovernorService } from './compound-governor.service';
import { DrainableRegistry } from '../lifecycle/drainable-registry';
import { ArchiveWriter } from '@sources/compound';

// Silence NestJS logs during tests
vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

// ---- Module-level mocks ----
// vi.mock is hoisted; factories must not reference top-level variables defined after the mock call.

vi.mock('@libs/db', () => ({
  pgDb: {
    selectFrom: vi.fn(),
    insertInto: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  },
  chDb: {},
}));

vi.mock('@libs/chain', () => ({
  parseChainConfigFromEnv: vi.fn(),
  EventPoller: vi.fn(),
  FailoverRpcClient: vi.fn(),
  getPendingEventCount: vi.fn().mockReturnValue({ set: vi.fn() }),
  getIndexerActiveSources: vi.fn().mockReturnValue({ set: vi.fn() }),
  resetMetrics: vi.fn(),
  toChainLogger: vi.fn().mockReturnValue({}),
}));

vi.mock('@sources/compound', () => ({
  ArchiveWriter: vi.fn(),
  makeIngesterListener: vi.fn().mockReturnValue(vi.fn()),
  COMPOUND_EVENT_TOPICS: {
    ProposalCreated: '0xaaa',
    ProposalQueued: '0xbbb',
    ProposalExecuted: '0xccc',
    ProposalCanceled: '0xddd',
  },
}));

// The service imports toChainLogger from a relative path — mock that module too
vi.mock('../utils/nest-logger-adapter', () => ({
  toChainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  parseChainConfigFromEnv,
  EventPoller,
  FailoverRpcClient,
  getPendingEventCount,
  getIndexerActiveSources,
} from '@libs/chain';
import { pgDb } from '@libs/db';

const CHAIN_CFG = {
  chainId: 1,
  name: 'ethereum',
  reorgHorizon: 12,
  lagThresholdBlocks: 5,
  overallTimeoutMs: 12000,
  providers: [],
};

function makeSource(
  id: string,
  primaryChainId: number,
  governorAddress = '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
) {
  return {
    id,
    dao_id: 'dao-1',
    source_config: { governor_address: governorAddress },
    primary_chain_id: primaryChainId,
  };
}

function buildSelectChain(rows: unknown[]) {
  return {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(rows),
    executeTakeFirst: vi.fn().mockResolvedValue(undefined),
  };
}

function setupMockPoller() {
  const pollerInstance = {
    onEvents: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(EventPoller).mockImplementation(function () {
    return pollerInstance;
  } as never);
  return pollerInstance;
}

function setupMockClient(startImpl: () => Promise<void> = () => Promise.resolve()) {
  const clientInstance = {
    start: vi.fn().mockImplementation(startImpl),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(FailoverRpcClient).mockImplementation(function () {
    return clientInstance;
  } as never);
  return clientInstance;
}

const mockArchiveWriter = { write: vi.fn() } as unknown as ArchiveWriter;

async function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      CompoundGovernorService,
      DrainableRegistry,
      { provide: ArchiveWriter, useValue: mockArchiveWriter },
    ],
  }).compile();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pgDb.selectFrom).mockReset();
  vi.mocked(pgDb.insertInto).mockReset();
  // Re-mock metric functions after clearAllMocks
  vi.mocked(getPendingEventCount).mockReturnValue({ set: vi.fn() });
  vi.mocked(getIndexerActiveSources).mockReturnValue({ set: vi.fn() });
});

describe('CompoundGovernorService', () => {
  it('#1 — bootstrap with 0 dao_source rows: no pollers/clients, gauge = 0', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    vi.mocked(pgDb.selectFrom).mockReturnValue(buildSelectChain([]));

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    expect(EventPoller).not.toHaveBeenCalled();
    expect(FailoverRpcClient).not.toHaveBeenCalled();
  });

  it('#2 — bootstrap with 1 dao_source row: 1 client, 1 poller, correct filter shape', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    vi.mocked(pgDb.selectFrom).mockReturnValue(buildSelectChain([makeSource('src-1', 1)]));

    const client = setupMockClient();
    const poller = setupMockPoller();

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    expect(client.start).toHaveBeenCalledTimes(1);
    expect(poller.start).toHaveBeenCalledTimes(1);
    expect(poller.onEvents).toHaveBeenCalledWith(expect.any(Function));

    const pollerArgs = vi.mocked(EventPoller).mock.calls[0]![0];
    expect(pollerArgs.filter.address).toBe('0xc0da02939e1441f497fd74f78ce7decb17b66529');
    expect(pollerArgs.filter.topics).toHaveLength(1);
    expect(pollerArgs.filter.topics[0]).toHaveLength(4);
  });

  it('#3 — 2 dao_source rows on same chain: 1 shared client, 2 pollers', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    vi.mocked(pgDb.selectFrom).mockReturnValue(
      buildSelectChain([
        makeSource('src-1', 1),
        makeSource('src-2', 1, '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      ]),
    );

    const client = setupMockClient();
    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    expect(client.start).toHaveBeenCalledTimes(1);
    expect(EventPoller).toHaveBeenCalledTimes(2);
  });

  it('#4 — 2 dao_source rows on different chains: 2 clients, 2 pollers', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([
      CHAIN_CFG,
      { ...CHAIN_CFG, chainId: 137, name: 'polygon' },
    ]);
    vi.mocked(pgDb.selectFrom).mockReturnValue(
      buildSelectChain([makeSource('src-1', 1), makeSource('src-2', 137)]),
    );

    const clientA = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const clientB = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(FailoverRpcClient)
      .mockImplementationOnce(function () {
        return clientA;
      } as never)
      .mockImplementationOnce(function () {
        return clientB;
      } as never);
    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    expect(clientA.start).toHaveBeenCalledTimes(1);
    expect(clientB.start).toHaveBeenCalledTimes(1);
    expect(EventPoller).toHaveBeenCalledTimes(2);
  });

  it('#5 — malformed source_config: throws BEFORE any client.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    vi.mocked(pgDb.selectFrom).mockReturnValue(
      buildSelectChain([makeSource('src-1', 1, 'not-a-valid-address')]),
    );

    const client = setupMockClient();

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await expect(service.onApplicationBootstrap()).rejects.toThrow(/malformed source_config/);
    expect(client.start).not.toHaveBeenCalled();
  });

  it('#6 — chain not in CHAIN_CONFIG: throws before any client.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]); // only chain 1
    vi.mocked(pgDb.selectFrom).mockReturnValue(buildSelectChain([makeSource('src-1', 999)]));

    const client = setupMockClient();

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await expect(service.onApplicationBootstrap()).rejects.toThrow(/CHAIN_CONFIG has no entry/);
    expect(client.start).not.toHaveBeenCalled();
  });

  it('#7 — DrainableRegistry: service registers self, drainAll invokes drain() once', async () => {
    const module = await buildModule();
    const registry = module.get(DrainableRegistry);
    const service = module.get(CompoundGovernorService);
    const drainSpy = vi.spyOn(service, 'drain').mockResolvedValue(undefined);

    await registry.drainAll();
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });

  it('#8 — drain: pollers stopped first, client stopped; allSettled absorbs individual failures', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    vi.mocked(pgDb.selectFrom).mockReturnValue(buildSelectChain([makeSource('src-1', 1)]));

    const client = setupMockClient();
    const pollerStop = vi.fn().mockRejectedValue(new Error('stop failed'));
    vi.mocked(EventPoller).mockImplementation(function () {
      return { onEvents: vi.fn(), start: vi.fn().mockResolvedValue(undefined), stop: pollerStop };
    } as never);

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    await expect(service.drain()).resolves.not.toThrow();
    expect(pollerStop).toHaveBeenCalled();
    expect(client.stop).toHaveBeenCalled();
  });

  it('#9 — DatabaseLifecycleService: drainAll resolves before pgDb.destroy is called', async () => {
    const { DatabaseLifecycleService } = await import('../lifecycle/database-lifecycle.service');

    const callOrder: string[] = [];
    const drainables = {
      drainAll: vi.fn().mockImplementation(async () => {
        callOrder.push('drain');
      }),
    };

    const destroySpy = vi.spyOn(pgDb, 'destroy').mockImplementation(async () => {
      callOrder.push('destroy');
    });

    const module = await Test.createTestingModule({
      providers: [{ provide: DrainableRegistry, useValue: drainables }, DatabaseLifecycleService],
    }).compile();

    const svc = module.get(DatabaseLifecycleService);
    await svc.onApplicationShutdown();

    expect(callOrder).toEqual(['drain', 'destroy']);
    destroySpy.mockRestore();
  });

  it('#10 — partial-bootstrap failure: client A stopped when client B.start() rejects', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([
      CHAIN_CFG,
      { ...CHAIN_CFG, chainId: 137, name: 'polygon' },
    ]);
    vi.mocked(pgDb.selectFrom).mockReturnValue(
      buildSelectChain([makeSource('src-1', 1), makeSource('src-2', 137)]),
    );

    const clientA = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const clientB = {
      start: vi.fn().mockRejectedValue(new Error('B failed')),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(FailoverRpcClient)
      .mockImplementationOnce(function () {
        return clientA;
      } as never)
      .mockImplementationOnce(function () {
        return clientB;
      } as never);

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);

    await expect(service.onApplicationBootstrap()).rejects.toThrow('B failed');
    expect(clientA.stop).toHaveBeenCalled();
  });
});
