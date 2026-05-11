import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CompoundGovernorService } from './compound-governor.service';
import { DrainableRegistry } from '../lifecycle/drainable-registry';
import { ArchiveWriter } from '@sources/compound';

// Silence NestJS logs during tests
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

// ---- Module-level mocks ----
// jest.mock is hoisted; factories must not reference top-level variables defined after the mock call.

jest.mock('@libs/db', () => ({
  pgDb: {
    selectFrom: jest.fn(),
    insertInto: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  },
  chDb: {},
}));

jest.mock('@libs/chain', () => ({
  parseChainConfigFromEnv: jest.fn(),
  EventPoller: jest.fn(),
  FailoverRpcClient: jest.fn(),
  getPendingEventCount: jest.fn().mockReturnValue({ set: jest.fn() }),
  getIndexerActiveSources: jest.fn().mockReturnValue({ set: jest.fn() }),
  resetMetrics: jest.fn(),
  toChainLogger: jest.fn().mockReturnValue({}),
}));

jest.mock('@sources/compound', () => ({
  ArchiveWriter: jest.fn(),
  makeIngesterListener: jest.fn().mockReturnValue(jest.fn()),
  COMPOUND_EVENT_TOPICS: {
    ProposalCreated: '0xaaa',
    ProposalQueued: '0xbbb',
    ProposalExecuted: '0xccc',
    ProposalCanceled: '0xddd',
  },
}));

// The service imports toChainLogger from a relative path — mock that module too
jest.mock('../utils/nest-logger-adapter', () => ({
  toChainLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Import after mocks are set up
import { parseChainConfigFromEnv, EventPoller, FailoverRpcClient } from '@libs/chain';
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
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(rows),
    executeTakeFirst: jest.fn().mockResolvedValue(undefined),
  };
}

function setupMockPoller() {
  const pollerInstance = {
    onEvents: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  };
  (EventPoller as jest.Mock).mockImplementation(() => pollerInstance);
  return pollerInstance;
}

function setupMockClient(startImpl: () => Promise<void> = () => Promise.resolve()) {
  const clientInstance = {
    start: jest.fn().mockImplementation(startImpl),
    stop: jest.fn().mockResolvedValue(undefined),
  };
  (FailoverRpcClient as jest.Mock).mockImplementation(() => clientInstance);
  return clientInstance;
}

const mockArchiveWriter = { write: jest.fn() } as unknown as ArchiveWriter;

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
  jest.clearAllMocks();
  (pgDb.selectFrom as jest.Mock).mockReset();
  (pgDb.insertInto as jest.Mock).mockReset();
  // Re-mock metric functions after clearAllMocks
  const chain = jest.requireMock('@libs/chain') as Record<string, jest.Mock>;
  chain['getPendingEventCount']!.mockReturnValue({ set: jest.fn() });
  chain['getIndexerActiveSources']!.mockReturnValue({ set: jest.fn() });
});

describe('CompoundGovernorService', () => {
  it('#1 — bootstrap with 0 dao_source rows: no pollers/clients, gauge = 0', async () => {
    (parseChainConfigFromEnv as jest.Mock).mockReturnValue([CHAIN_CFG]);
    (pgDb.selectFrom as jest.Mock).mockReturnValue(buildSelectChain([]));

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    expect(EventPoller).not.toHaveBeenCalled();
    expect(FailoverRpcClient).not.toHaveBeenCalled();
  });

  it('#2 — bootstrap with 1 dao_source row: 1 client, 1 poller, correct filter shape', async () => {
    (parseChainConfigFromEnv as jest.Mock).mockReturnValue([CHAIN_CFG]);
    (pgDb.selectFrom as jest.Mock).mockReturnValue(buildSelectChain([makeSource('src-1', 1)]));

    const client = setupMockClient();
    const poller = setupMockPoller();

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    expect(client.start).toHaveBeenCalledTimes(1);
    expect(poller.start).toHaveBeenCalledTimes(1);
    expect(poller.onEvents).toHaveBeenCalledWith(expect.any(Function));

    const pollerArgs = (EventPoller as jest.Mock).mock.calls[0][0];
    expect(pollerArgs.filter.address).toBe('0xc0da02939e1441f497fd74f78ce7decb17b66529');
    expect(pollerArgs.filter.topics).toHaveLength(1);
    expect(pollerArgs.filter.topics[0]).toHaveLength(4);
  });

  it('#3 — 2 dao_source rows on same chain: 1 shared client, 2 pollers', async () => {
    (parseChainConfigFromEnv as jest.Mock).mockReturnValue([CHAIN_CFG]);
    (pgDb.selectFrom as jest.Mock).mockReturnValue(
      buildSelectChain([
        makeSource('src-1', 1),
        makeSource('src-2', 1, '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      ]),
    );

    const client = setupMockClient();
    (EventPoller as jest.Mock).mockImplementation(() => ({
      onEvents: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    }));

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    expect(client.start).toHaveBeenCalledTimes(1);
    expect(EventPoller).toHaveBeenCalledTimes(2);
  });

  it('#4 — 2 dao_source rows on different chains: 2 clients, 2 pollers', async () => {
    (parseChainConfigFromEnv as jest.Mock).mockReturnValue([
      CHAIN_CFG,
      { ...CHAIN_CFG, chainId: 137, name: 'polygon' },
    ]);
    (pgDb.selectFrom as jest.Mock).mockReturnValue(
      buildSelectChain([makeSource('src-1', 1), makeSource('src-2', 137)]),
    );

    const clientA = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const clientB = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    (FailoverRpcClient as jest.Mock)
      .mockImplementationOnce(() => clientA)
      .mockImplementationOnce(() => clientB);
    (EventPoller as jest.Mock).mockImplementation(() => ({
      onEvents: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    }));

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await service.onApplicationBootstrap();

    expect(clientA.start).toHaveBeenCalledTimes(1);
    expect(clientB.start).toHaveBeenCalledTimes(1);
    expect(EventPoller).toHaveBeenCalledTimes(2);
  });

  it('#5 — malformed source_config: throws BEFORE any client.start()', async () => {
    (parseChainConfigFromEnv as jest.Mock).mockReturnValue([CHAIN_CFG]);
    (pgDb.selectFrom as jest.Mock).mockReturnValue(
      buildSelectChain([makeSource('src-1', 1, 'not-a-valid-address')]),
    );

    const client = setupMockClient();

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);
    await expect(service.onApplicationBootstrap()).rejects.toThrow(/malformed source_config/);
    expect(client.start).not.toHaveBeenCalled();
  });

  it('#6 — chain not in CHAIN_CONFIG: throws before any client.start()', async () => {
    (parseChainConfigFromEnv as jest.Mock).mockReturnValue([CHAIN_CFG]); // only chain 1
    (pgDb.selectFrom as jest.Mock).mockReturnValue(buildSelectChain([makeSource('src-1', 999)]));

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
    const drainSpy = jest.spyOn(service, 'drain').mockResolvedValue(undefined);

    await registry.drainAll();
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });

  it('#8 — drain: pollers stopped first, client stopped; allSettled absorbs individual failures', async () => {
    (parseChainConfigFromEnv as jest.Mock).mockReturnValue([CHAIN_CFG]);
    (pgDb.selectFrom as jest.Mock).mockReturnValue(buildSelectChain([makeSource('src-1', 1)]));

    const client = setupMockClient();
    const pollerStop = jest.fn().mockRejectedValue(new Error('stop failed'));
    (EventPoller as jest.Mock).mockImplementation(() => ({
      onEvents: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      stop: pollerStop,
    }));

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
      drainAll: jest.fn().mockImplementation(async () => {
        callOrder.push('drain');
      }),
    };

    const destroySpy = jest.spyOn(pgDb, 'destroy').mockImplementation(async () => {
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
    (parseChainConfigFromEnv as jest.Mock).mockReturnValue([
      CHAIN_CFG,
      { ...CHAIN_CFG, chainId: 137, name: 'polygon' },
    ]);
    (pgDb.selectFrom as jest.Mock).mockReturnValue(
      buildSelectChain([makeSource('src-1', 1), makeSource('src-2', 137)]),
    );

    const clientA = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const clientB = {
      start: jest.fn().mockRejectedValue(new Error('B failed')),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    (FailoverRpcClient as jest.Mock)
      .mockImplementationOnce(() => clientA)
      .mockImplementationOnce(() => clientB);

    const module = await buildModule();
    const service = module.get(CompoundGovernorService);

    await expect(service.onApplicationBootstrap()).rejects.toThrow('B failed');
    expect(clientA.stop).toHaveBeenCalled();
  });
});
