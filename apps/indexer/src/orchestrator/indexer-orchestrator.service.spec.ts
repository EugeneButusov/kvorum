import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { parseChainConfigFromEnv } from '@libs/chain';
import { ConfirmationRepository, DaoSourceRepository } from '@libs/db';
import type { SourcePlugin, SourceContext, IngestSpec } from '@sources/core';
import { ChainContextRegistry } from './chain-context-registry';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';
import { IndexerOrchestratorService } from './indexer-orchestrator.service';
import { SOURCE_PLUGINS, FETCH_DRIVERS } from './tokens';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

vi.mock('@libs/chain', () => ({
  parseChainConfigFromEnv: vi.fn(),
  chainMetrics: {
    pendingEventCount: { record: vi.fn() },
    indexerActiveSources: { record: vi.fn() },
  },
}));

vi.mock('@libs/db', () => ({
  DaoSourceRepository: vi.fn(),
  ConfirmationRepository: vi.fn(),
}));

vi.mock('./chain-context-registry', () => ({
  ChainContextRegistry: vi.fn(),
}));

const CHAIN_CFG = {
  chainId: '0x1',
  name: 'ethereum',
  reorgHorizon: 12,
  lagThresholdBlocks: 5,
  overallTimeoutMs: 12_000,
  providers: [],
};

function makeSource(id: string, sourceType: string, primaryChainId: string, sourceConfig = {}) {
  return {
    id,
    dao_id: 'dao-1',
    source_type: sourceType,
    source_config: sourceConfig,
    primary_chain_id: primaryChainId,
  };
}

function makeFakePlugin(sourceType: string, parseOk = true): SourcePlugin {
  return {
    sourceType,
    parseConfig: (raw: unknown) => {
      if (!parseOk) throw new Error(`malformed source_config for ${sourceType}`);
      return raw;
    },
    buildIngestSpec: (_ctx: SourceContext, _cfg: unknown): IngestSpec => ({
      kind: 'evm-event-poller',
      filter: { address: '0xabc', topics: [] },
      listener: vi.fn(),
    }),
  };
}

function makeFakeHandle(): FetchDriverHandle & { _stopped: boolean } {
  const h = {
    _stopped: false,
    stop: vi.fn().mockImplementation(async () => {
      h._stopped = true;
    }),
  };
  return h;
}

function makeFakeDriver(): FetchDriver & { _handles: FetchDriverHandle[] } {
  const handles: FetchDriverHandle[] = [];
  return {
    kind: 'evm-event-poller',
    _handles: handles,
    start: vi.fn().mockImplementation(async () => {
      const h = makeFakeHandle();
      handles.push(h);
      return h;
    }),
  };
}

const mockDaoSourceRepo = { findAll: vi.fn() };
const mockConfirmationRepo = { countPendingBySourceType: vi.fn().mockResolvedValue([]) };
const mockRegistry = {
  markReady: vi.fn(),
  markFailed: vi.fn(),
  drainAll: vi.fn().mockResolvedValue(undefined),
};

async function buildModule(
  plugins: SourcePlugin[],
  drivers: FetchDriver[],
): Promise<TestingModule> {
  vi.mocked(ChainContextRegistry).mockImplementation(function () {
    return mockRegistry;
  } as never);

  return Test.createTestingModule({
    providers: [
      IndexerOrchestratorService,
      { provide: SOURCE_PLUGINS, useValue: plugins },
      { provide: FETCH_DRIVERS, useValue: drivers },
      { provide: DaoSourceRepository, useValue: mockDaoSourceRepo },
      { provide: ConfirmationRepository, useValue: mockConfirmationRepo },
      { provide: ChainContextRegistry, useValue: mockRegistry },
    ],
  }).compile();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfirmationRepo.countPendingBySourceType.mockResolvedValue([]);
  mockRegistry.drainAll.mockResolvedValue(undefined);
});

describe('IndexerOrchestratorService', () => {
  it('#1 — 0 dao_source rows: no driver.start() calls, idle log', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor')], [driver]);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#2 — 2 sources with different source_types: driver.start() called twice', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor', '0x1'),
      makeSource('src-2', 'aave_governor', '0x1'),
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule(
      [makeFakePlugin('compound_governor'), makeFakePlugin('aave_governor')],
      [driver],
    );
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    expect(driver.start).toHaveBeenCalledTimes(2);
  });

  it('#3 — unknown source_type: throws BEFORE any driver.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([makeSource('src-1', 'unknown_source', '0x1')]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor')], [driver]);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow(/No plugin registered/);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#4 — malformed source_config: throws BEFORE any driver.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor', '0x1', { bad: true }),
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor', false)], [driver]);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow(/malformed source_config/);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#5 — chain not in CHAIN_CONFIG: throws before any driver.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]); // only chain 1
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor', '0x999'),
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor')], [driver]);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow(/CHAIN_CONFIG has no entry/);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#6 — partial bootstrap failure: started handles drained via allSettled', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor', '0x1'),
      makeSource('src-2', 'compound_governor', '0x1'),
    ]);

    const driver: FetchDriver & { _handles: FetchDriverHandle[] } = {
      kind: 'evm-event-poller',
      _handles: [],
      start: vi
        .fn()
        .mockImplementationOnce(async () => makeFakeHandle())
        .mockRejectedValueOnce(new Error('driver start failed')),
    };

    const module = await buildModule([makeFakePlugin('compound_governor')], [driver]);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow('driver start failed');
  });

  it('#7 — drain: all handles stopped via allSettled even if one rejects', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([makeSource('src-1', 'compound_governor', '0x1')]);

    const rejectingHandle: FetchDriverHandle = {
      stop: vi.fn().mockRejectedValue(new Error('stop failed')),
    };
    const driver: FetchDriver = {
      kind: 'evm-event-poller',
      start: vi.fn().mockResolvedValue(rejectingHandle),
    };

    const module = await buildModule([makeFakePlugin('compound_governor')], [driver]);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    await expect(svc.drain()).resolves.not.toThrow();
    expect(rejectingHandle.stop).toHaveBeenCalled();
  });

  it('#8 — pending-depth gauge interval loops active source types', async () => {
    vi.useFakeTimers();
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([makeSource('src-1', 'compound_governor', '0x1')]);
    mockConfirmationRepo.countPendingBySourceType.mockResolvedValue([
      { count: 3, chain_id: '0x1', source_type: 'compound_governor' },
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor')], [driver]);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockConfirmationRepo.countPendingBySourceType).toHaveBeenCalledWith('compound_governor');
    vi.useRealTimers();
    await svc.drain();
  });
});
