import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { parseChainConfigFromEnv, ChainContextRegistry, chainMetrics } from '@libs/chain';
import { ConfirmationRepository, DaoSourceRepository } from '@libs/db';
import type { SourcePlugin, SourceContext, IngestSpec } from '@sources/core';
import { BackfillAlreadyStartedError, runBootCatchUp } from '@sources/core';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';
import { IndexerOrchestratorService } from './indexer-orchestrator.service';
import { ReorgWatcherService } from './reorg-watcher.service';
import { SOURCE_PLUGINS, FETCH_DRIVERS } from './tokens';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

vi.mock('@libs/chain', () => ({
  parseChainConfigFromEnv: vi.fn(),
  reorgCutoff: vi.fn(
    (head: bigint, cfg: { reorgHorizon: number }) => head - BigInt(cfg.reorgHorizon) * 2n,
  ),
  ChainContextRegistry: vi.fn(),
  silentLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  chainMetrics: {
    pendingEventCount: { record: vi.fn() },
    indexerActiveSources: { record: vi.fn() },
    ingestionGapFillFailed: { add: vi.fn() },
    ingestionGapFillSkipped: { add: vi.fn() },
  },
}));

vi.mock('@libs/db', () => ({
  DaoSourceRepository: vi.fn(),
  ConfirmationRepository: vi.fn(),
  pgDb: {},
}));

vi.mock('@sources/core', () => ({
  SOURCE_PLUGINS: 'SOURCE_PLUGINS',
  runBootCatchUp: vi.fn(),
  BootCatchUpShutdownError: class BootCatchUpShutdownError extends Error {
    constructor() {
      super('boot catch-up cancelled by shutdown');
      this.name = 'BootCatchUpShutdownError';
    }
  },
  BackfillAlreadyStartedError: class BackfillAlreadyStartedError extends Error {
    constructor(daoSourceId: string, startedAtBlock: string) {
      super(
        `Cannot start a fresh backfill for dao_source ${daoSourceId}: ` +
          `a backfill is already in progress (started at block ${startedAtBlock}). ` +
          `Pass force=true to clear state and re-capture, or use mode='resume' to continue.`,
      );
      this.name = 'BackfillAlreadyStartedError';
    }
  },
}));

vi.mock('./reorg-watcher.service', () => ({
  ReorgWatcherService: vi.fn(),
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
    supportedChainIds: ['0x1', '0x89', '0x999'],
    parseConfig: (raw: unknown) => {
      if (!parseOk) throw new Error(`malformed source_config for ${sourceType}`);
      return raw;
    },
    buildBackfillRuntime: () => ({
      filter: { address: '0xabc', topics: [] },
      listenerFactory: () => vi.fn(),
    }),
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
    start: vi.fn().mockImplementation(async (_spec, _ctx, _chainCfg, opts) => {
      opts?.onFirstTickComplete?.(16n);
      const h = makeFakeHandle();
      handles.push(h);
      return h;
    }),
  };
}

const mockDaoSourceRepo = { findAll: vi.fn() };
const mockConfirmationRepo = { countPendingBySourceType: vi.fn().mockResolvedValue([]) };
const mockRegistry = {
  getOrCreate: vi.fn().mockResolvedValue({ client: { send: vi.fn() } }),
  allActive: vi.fn().mockReturnValue([]),
  drainAll: vi.fn().mockResolvedValue(undefined),
};

const mockReorgWatcher = {
  watch: vi.fn(),
};

async function buildModule(plugins: SourcePlugin[], driver: FetchDriver): Promise<TestingModule> {
  vi.mocked(ChainContextRegistry).mockImplementation(function () {
    return mockRegistry;
  } as never);
  vi.mocked(ReorgWatcherService).mockImplementation(function () {
    return mockReorgWatcher;
  } as never);

  return Test.createTestingModule({
    providers: [
      IndexerOrchestratorService,
      { provide: SOURCE_PLUGINS, useValue: plugins },
      { provide: FETCH_DRIVERS, useValue: [driver] },
      { provide: DaoSourceRepository, useValue: mockDaoSourceRepo },
      { provide: ConfirmationRepository, useValue: mockConfirmationRepo },
      { provide: ChainContextRegistry, useValue: mockRegistry },
      { provide: ReorgWatcherService, useValue: mockReorgWatcher },
    ],
  }).compile();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfirmationRepo.countPendingBySourceType.mockResolvedValue([]);
  mockRegistry.getOrCreate.mockResolvedValue({
    client: { send: vi.fn().mockResolvedValue('0x10') },
  });
  mockRegistry.allActive.mockReturnValue([]);
  mockRegistry.drainAll.mockResolvedValue(undefined);
  vi.mocked(runBootCatchUp).mockResolvedValue({ status: 'no_gap' });
});

describe('IndexerOrchestratorService', () => {
  it('#1 — 0 dao_source rows: no driver.start() calls, idle log', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#2 — 2 sources with different source_types: driver.start() called twice', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
      makeSource('src-2', 'aave_governor', '0x1'),
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule(
      [makeFakePlugin('compound_governor_bravo'), makeFakePlugin('aave_governor')],
      driver,
    );
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    expect(driver.start).toHaveBeenCalledTimes(2);
  });

  it('#2b — BackfillAlreadyStartedError from boot catch-up is skipped and driver still starts', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
    ]);
    vi.mocked(runBootCatchUp).mockRejectedValueOnce(
      new BackfillAlreadyStartedError('src-1', '100'),
    );

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    expect(driver.start).toHaveBeenCalledTimes(1);
  });

  it('#3 — unknown source_type: throws BEFORE any driver.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([makeSource('src-1', 'unknown_source', '0x1')]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow(/No plugin registered/);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#4 — malformed source_config: throws BEFORE any driver.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1', { bad: true }),
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo', false)], driver);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow(/malformed source_config/);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#5 — chain not in CHAIN_CONFIG: throws BEFORE any driver.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]); // only chain 0x1
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x999'),
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow(/No chain config/);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#5b — unsupported chain for plugin: source skipped, driver.start() not called', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x89'), // polygon, not supported
    ]);

    const driver = makeFakeDriver();
    const plugin: SourcePlugin = {
      ...makeFakePlugin('compound_governor_bravo'),
      supportedChainIds: ['0x1'],
    };
    const module = await buildModule([plugin], driver);
    const svc = module.get(IndexerOrchestratorService);

    await svc.onApplicationBootstrap();
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#6 — partial bootstrap failure: started handles drained via allSettled', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
      makeSource('src-2', 'compound_governor_bravo', '0x1'),
    ]);

    const driver: FetchDriver & { _handles: FetchDriverHandle[] } = {
      kind: 'evm-event-poller',
      _handles: [],
      start: vi
        .fn()
        .mockImplementationOnce(async () => makeFakeHandle())
        .mockRejectedValueOnce(new Error('driver start failed')),
    };

    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow('driver start failed');
  });

  it('#7 — drain: all handles stopped via allSettled even if one rejects', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
    ]);

    const rejectingHandle: FetchDriverHandle = {
      stop: vi.fn().mockRejectedValue(new Error('stop failed')),
    };
    const driver: FetchDriver = {
      kind: 'evm-event-poller',
      start: vi.fn().mockResolvedValue(rejectingHandle),
    };

    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    await expect(svc.drain()).resolves.not.toThrow();
    expect(rejectingHandle.stop).toHaveBeenCalled();
  });

  it('#8 — pending-depth gauge interval loops active source types', async () => {
    vi.useFakeTimers();
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
    ]);
    mockConfirmationRepo.countPendingBySourceType.mockResolvedValue([
      { count: 3, chain_id: '0x1', source_type: 'compound_governor_bravo' },
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockConfirmationRepo.countPendingBySourceType).toHaveBeenCalledWith(
      'compound_governor_bravo',
    );
    vi.useRealTimers();
    await svc.drain();
  });

  describe('INDEXER_LIVE_POLLER_ENABLED gate', () => {
    afterEach(() => {
      delete process.env['INDEXER_LIVE_POLLER_ENABLED'];
    });

    it('#9 — flag unset: live poller starts (existing behaviour, regression guard)', async () => {
      delete process.env['INDEXER_LIVE_POLLER_ENABLED'];
      vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
      mockDaoSourceRepo.findAll.mockResolvedValue([
        makeSource('src-1', 'compound_governor_bravo', '0x1'),
      ]);

      const driver = makeFakeDriver();
      const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
      const svc = module.get(IndexerOrchestratorService);
      await svc.onApplicationBootstrap();

      expect(driver.start).toHaveBeenCalledTimes(1);
    });

    it('#10 — flag="true": live poller starts', async () => {
      process.env['INDEXER_LIVE_POLLER_ENABLED'] = 'true';
      vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
      mockDaoSourceRepo.findAll.mockResolvedValue([
        makeSource('src-1', 'compound_governor_bravo', '0x1'),
      ]);

      const driver = makeFakeDriver();
      const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
      const svc = module.get(IndexerOrchestratorService);
      await svc.onApplicationBootstrap();

      expect(driver.start).toHaveBeenCalledTimes(1);
    });

    it('#11 — flag="false": poller does not start; daoSourceRepo not called; no driver.start()', async () => {
      process.env['INDEXER_LIVE_POLLER_ENABLED'] = 'false';

      const driver = makeFakeDriver();
      const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
      const svc = module.get(IndexerOrchestratorService);
      await svc.onApplicationBootstrap();

      expect(driver.start).not.toHaveBeenCalled();
      expect(mockDaoSourceRepo.findAll).not.toHaveBeenCalled();
    });

    it('#12 — flag="false": bootstrap completes without CHAIN_CONFIG (no parseChainConfigFromEnv call)', async () => {
      process.env['INDEXER_LIVE_POLLER_ENABLED'] = 'false';

      const driver = makeFakeDriver();
      const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
      const svc = module.get(IndexerOrchestratorService);
      await svc.onApplicationBootstrap();

      expect(parseChainConfigFromEnv).not.toHaveBeenCalled();
    });
  });

  it('#13 — evm-block-head-poller spec: routed to block-head driver, not event-poller driver', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo_reconcile', '0x1'),
    ]);

    const blockHeadPlugin: SourcePlugin = {
      sourceType: 'compound_governor_bravo_reconcile',
      supportedChainIds: ['0x1'],
      parseConfig: (raw: unknown) => raw,
      buildBackfillRuntime: () => ({
        filter: { address: '0xabc', topics: [] },
        listenerFactory: () => vi.fn(),
      }),
      buildIngestSpec: (): IngestSpec => ({
        kind: 'evm-block-head-poller',
        listener: vi.fn(),
      }),
    };

    const eventDriver = makeFakeDriver(); // kind: 'evm-event-poller'
    const blockHeadDriver: FetchDriver = {
      kind: 'evm-block-head-poller',
      start: vi.fn().mockResolvedValue(makeFakeHandle()),
    };

    vi.mocked(ChainContextRegistry).mockImplementation(function () {
      return mockRegistry;
    } as never);
    vi.mocked(ReorgWatcherService).mockImplementation(function () {
      return mockReorgWatcher;
    } as never);

    const module = await Test.createTestingModule({
      providers: [
        IndexerOrchestratorService,
        { provide: SOURCE_PLUGINS, useValue: [blockHeadPlugin] },
        { provide: FETCH_DRIVERS, useValue: [eventDriver, blockHeadDriver] },
        { provide: DaoSourceRepository, useValue: mockDaoSourceRepo },
        { provide: ConfirmationRepository, useValue: mockConfirmationRepo },
        { provide: ChainContextRegistry, useValue: mockRegistry },
        { provide: ReorgWatcherService, useValue: mockReorgWatcher },
      ],
    }).compile();

    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    expect(blockHeadDriver.start).toHaveBeenCalledTimes(1);
    expect(eventDriver.start).not.toHaveBeenCalled();
  });

  it('#14 — unknown IngestSpec kind: throws before any driver.start()', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
    ]);

    const unknownKindPlugin: SourcePlugin = {
      sourceType: 'compound_governor_bravo',
      supportedChainIds: ['0x1'],
      parseConfig: (raw: unknown) => raw,
      buildBackfillRuntime: () => ({
        filter: { address: '0xabc', topics: [] },
        listenerFactory: () => vi.fn(),
      }),
      buildIngestSpec: (): IngestSpec => ({
        kind: 'evm-event-poller',
        filter: { address: '0x0', topics: [] },
        listener: vi.fn(),
      }),
    };
    // Override spec kind after type-check by casting
    unknownKindPlugin.buildIngestSpec = (): never => ({ kind: 'unknown-kind' }) as never;

    const driver = makeFakeDriver();
    const module = await buildModule([unknownKindPlugin], driver);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).rejects.toThrow(/No FetchDriver registered/);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('#15 — BackfillAlreadyStartedError during boot catch-up is skipped and live driver starts', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
    ]);
    vi.mocked(runBootCatchUp).mockRejectedValueOnce(
      new BackfillAlreadyStartedError('src-1', '100'),
    );

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    expect(chainMetrics.ingestionGapFillSkipped.add).not.toHaveBeenCalled();
    expect(driver.start).toHaveBeenCalledTimes(1);
  });

  it('#16 — boot catch-up returns without throw and live driver starts', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
    ]);
    vi.mocked(runBootCatchUp).mockResolvedValueOnce({ status: 'no_gap' });

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    expect(driver.start).toHaveBeenCalledTimes(1);
  });
});
