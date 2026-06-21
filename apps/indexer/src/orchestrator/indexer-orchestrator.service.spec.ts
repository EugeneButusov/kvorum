import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { parseChainConfigFromEnv, ChainContextRegistry, chainMetrics } from '@libs/chain';
import { ArchiveEventRepository, DaoSourceRepository } from '@libs/db';
import type { SourceIngester, SourceContext, IngestSpec } from '@sources/core';
import { BackfillAlreadyStartedError, runBootCatchUp, SOURCE_INGESTERS } from '@sources/core';
import type { FetchDriver, FetchDriverHandle } from './fetch-driver';
import { IndexerOrchestratorService } from './indexer-orchestrator.service';
import { orchestratorMetrics } from './orchestrator-metrics';
import { FETCH_DRIVERS, QUEUE_PRODUCER_PORT } from './tokens';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

vi.mock('@libs/chain', () => ({
  parseChainConfigFromEnv: vi.fn(),
  ChainContextRegistry: vi.fn(),
  silentLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  chainMetrics: {
    underivedDepth: { record: vi.fn() },
    indexerActiveSources: { record: vi.fn() },
    ingestionGapFillFailed: { add: vi.fn() },
    ingestionGapFillSkipped: { add: vi.fn() },
  },
}));

vi.mock('@libs/db', () => ({
  DaoSourceRepository: vi.fn(),
  ArchiveEventRepository: vi.fn(),
  pgDb: {},
}));

vi.mock('@sources/core', () => ({
  SOURCE_INGESTERS: 'SOURCE_INGESTERS',
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

const CHAIN_CFG = {
  chainId: '0x1',
  name: 'ethereum',
  headLag: 12,
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
    chain_id: primaryChainId,
  };
}

function makeFakePlugin(sourceType: string, parseOk = true): SourceIngester {
  return {
    sourceType,
    supportedChainIds: ['0x1', '0x89', '0x999'],
    transport: 'evm',
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
      opts?.onFirstHeadComplete?.(16n);
      const h = makeFakeHandle();
      handles.push(h);
      return h;
    }),
  };
}

const mockDaoSourceRepo = { findAll: vi.fn() };
const mockConfirmationRepo = { countUnderivedBySourceType: vi.fn().mockResolvedValue([]) };
const mockRegistry = {
  getOrCreate: vi.fn().mockResolvedValue({ client: { send: vi.fn() } }),
  allActive: vi.fn().mockReturnValue([]),
  drainAll: vi.fn().mockResolvedValue(undefined),
};

const STUB_QUEUE_PRODUCER_PORT = {
  loadCursor: vi.fn().mockResolvedValue(null),
  commitTick: vi.fn().mockResolvedValue(undefined),
};

async function buildModule(plugins: SourceIngester[], driver: FetchDriver): Promise<TestingModule> {
  vi.mocked(ChainContextRegistry).mockImplementation(function () {
    return mockRegistry;
  } as never);

  return Test.createTestingModule({
    providers: [
      IndexerOrchestratorService,
      { provide: SOURCE_INGESTERS, useValue: plugins },
      { provide: FETCH_DRIVERS, useValue: [driver] },
      { provide: QUEUE_PRODUCER_PORT, useValue: STUB_QUEUE_PRODUCER_PORT },
      { provide: DaoSourceRepository, useValue: mockDaoSourceRepo },
      { provide: ArchiveEventRepository, useValue: mockConfirmationRepo },
      { provide: ChainContextRegistry, useValue: mockRegistry },
    ],
  }).compile();
}

function makeFakePollPlugin(sourceType: string): SourceIngester {
  return {
    sourceType,
    supportedChainIds: ['off-chain'],
    transport: 'offchain',
    parseConfig: (raw: unknown) => raw,
    buildBackfillRuntime: () => {
      throw new Error('poll sources do not support backfill runtime');
    },
    buildIngestSpec: (): IngestSpec => ({
      kind: 'poll',
      listener: {
        intervalMs: 60_000,
        poll: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      },
    }),
  };
}

function makeFakePollDriver(): FetchDriver<'poll'> & { _handles: FetchDriverHandle[] } {
  const handles: FetchDriverHandle[] = [];
  return {
    kind: 'poll',
    _handles: handles,
    start: vi.fn().mockImplementation(async () => {
      const h = makeFakeHandle();
      handles.push(h);
      return h;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfirmationRepo.countUnderivedBySourceType.mockResolvedValue([]);
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

  it('#3 — unregistered source_type: skipped with warn + metric; registered sibling still starts (ADR-0073)', async () => {
    vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
    // A registered EVM source alongside two seeded-ahead off-chain sources with no plugin yet
    // (snapshot/discourse_forum are seeded before AD1/AE2 build them).
    mockDaoSourceRepo.findAll.mockResolvedValue([
      makeSource('src-1', 'compound_governor_bravo', '0x1'),
      makeSource('src-2', 'snapshot', 'off-chain'),
      makeSource('src-3', 'discourse_forum', 'off-chain'),
    ]);

    const addSpy = vi.spyOn(orchestratorMetrics.daoSourceUnregistered, 'add');

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);

    await expect(svc.onApplicationBootstrap()).resolves.not.toThrow();

    // The registered source starts; the two unregistered ones are skipped, not fatal.
    expect(driver.start).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenCalledWith(1, { source_type: 'snapshot' });
    expect(addSpy).toHaveBeenCalledWith(1, { source_type: 'discourse_forum' });
    expect(vi.mocked(Logger.prototype.warn)).toHaveBeenCalledWith('dao_source_no_plugin', {
      source_type: 'snapshot',
      dao_source_id: 'src-2',
    });

    await svc.drain();
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
    const plugin: SourceIngester = {
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
    mockConfirmationRepo.countUnderivedBySourceType.mockResolvedValue([
      { count: 3, chain_id: '0x1', source_type: 'compound_governor_bravo' },
    ]);

    const driver = makeFakeDriver();
    const module = await buildModule([makeFakePlugin('compound_governor_bravo')], driver);
    const svc = module.get(IndexerOrchestratorService);
    await svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockConfirmationRepo.countUnderivedBySourceType).toHaveBeenCalledWith(
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

    const blockHeadPlugin: SourceIngester = {
      sourceType: 'compound_governor_bravo_reconcile',
      supportedChainIds: ['0x1'],
      transport: 'evm',
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

    const module = await Test.createTestingModule({
      providers: [
        IndexerOrchestratorService,
        { provide: SOURCE_INGESTERS, useValue: [blockHeadPlugin] },
        { provide: FETCH_DRIVERS, useValue: [eventDriver, blockHeadDriver] },
        { provide: DaoSourceRepository, useValue: mockDaoSourceRepo },
        { provide: ArchiveEventRepository, useValue: mockConfirmationRepo },
        { provide: ChainContextRegistry, useValue: mockRegistry },
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

    const unknownKindPlugin: SourceIngester = {
      sourceType: 'compound_governor_bravo',
      supportedChainIds: ['0x1'],
      transport: 'evm',
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

  describe('poll source routing', () => {
    it('#P1 — poll source starts via poll driver without requiring a chainConfig', async () => {
      vi.mocked(parseChainConfigFromEnv).mockReturnValue([]); // no EVM chains configured
      mockDaoSourceRepo.findAll.mockResolvedValue([
        makeSource('src-poll-1', 'snapshot', 'off-chain'),
      ]);

      const evmDriver = makeFakeDriver();
      const pollDriver = makeFakePollDriver();

      vi.mocked(ChainContextRegistry).mockImplementation(function () {
        return mockRegistry;
      } as never);

      const module = await Test.createTestingModule({
        providers: [
          IndexerOrchestratorService,
          { provide: SOURCE_INGESTERS, useValue: [makeFakePollPlugin('snapshot')] },
          { provide: FETCH_DRIVERS, useValue: [evmDriver, pollDriver] },
          { provide: QUEUE_PRODUCER_PORT, useValue: STUB_QUEUE_PRODUCER_PORT },
          { provide: DaoSourceRepository, useValue: mockDaoSourceRepo },
          { provide: ArchiveEventRepository, useValue: mockConfirmationRepo },
          { provide: ChainContextRegistry, useValue: mockRegistry },
        ],
      }).compile();

      const svc = module.get(IndexerOrchestratorService);
      await expect(svc.onApplicationBootstrap()).resolves.not.toThrow();

      expect(pollDriver.start).toHaveBeenCalledTimes(1);
      expect(evmDriver.start).not.toHaveBeenCalled();

      await svc.drain();
    });

    it('#P2 — poll source is excluded from activeSources (lag gauge); EVM source is included', async () => {
      vi.useFakeTimers();
      vi.mocked(parseChainConfigFromEnv).mockReturnValue([CHAIN_CFG]);
      mockDaoSourceRepo.findAll.mockResolvedValue([
        makeSource('src-1', 'compound_governor_bravo', '0x1'),
        makeSource('src-poll-1', 'snapshot', 'off-chain'),
      ]);

      const evmDriver = makeFakeDriver();
      const pollDriver = makeFakePollDriver();

      vi.mocked(ChainContextRegistry).mockImplementation(function () {
        return mockRegistry;
      } as never);

      const module = await Test.createTestingModule({
        providers: [
          IndexerOrchestratorService,
          {
            provide: SOURCE_INGESTERS,
            useValue: [makeFakePlugin('compound_governor_bravo'), makeFakePollPlugin('snapshot')],
          },
          { provide: FETCH_DRIVERS, useValue: [evmDriver, pollDriver] },
          { provide: QUEUE_PRODUCER_PORT, useValue: STUB_QUEUE_PRODUCER_PORT },
          { provide: DaoSourceRepository, useValue: mockDaoSourceRepo },
          { provide: ArchiveEventRepository, useValue: mockConfirmationRepo },
          { provide: ChainContextRegistry, useValue: mockRegistry },
        ],
      }).compile();

      const svc = module.get(IndexerOrchestratorService);
      await svc.onApplicationBootstrap();

      // Clear calls made during boot catch-up, isolate the gauge interval
      mockRegistry.getOrCreate.mockClear();

      // Advance gauge interval — registry.getOrCreate should be called once (EVM only)
      await vi.advanceTimersByTimeAsync(10_000);
      // The EVM dao_source triggers getOrCreate; the poll source must NOT
      expect(mockRegistry.getOrCreate).toHaveBeenCalledTimes(1);
      expect(mockRegistry.getOrCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({ chainId: 'off-chain' }),
      );

      vi.useRealTimers();
      await svc.drain();
    });

    it('#P3 — missing chainConfig for EVM still throws even when a poll source is present', async () => {
      vi.mocked(parseChainConfigFromEnv).mockReturnValue([]); // no chains
      mockDaoSourceRepo.findAll.mockResolvedValue([
        makeSource('src-1', 'compound_governor_bravo', '0x1'), // EVM, no chain cfg
        makeSource('src-poll-1', 'snapshot', 'off-chain'),
      ]);

      const evmDriver = makeFakeDriver();
      const pollDriver = makeFakePollDriver();

      vi.mocked(ChainContextRegistry).mockImplementation(function () {
        return mockRegistry;
      } as never);

      const module = await Test.createTestingModule({
        providers: [
          IndexerOrchestratorService,
          {
            provide: SOURCE_INGESTERS,
            useValue: [makeFakePlugin('compound_governor_bravo'), makeFakePollPlugin('snapshot')],
          },
          { provide: FETCH_DRIVERS, useValue: [evmDriver, pollDriver] },
          { provide: QUEUE_PRODUCER_PORT, useValue: STUB_QUEUE_PRODUCER_PORT },
          { provide: DaoSourceRepository, useValue: mockDaoSourceRepo },
          { provide: ArchiveEventRepository, useValue: mockConfirmationRepo },
          { provide: ChainContextRegistry, useValue: mockRegistry },
        ],
      }).compile();

      const svc = module.get(IndexerOrchestratorService);
      await expect(svc.onApplicationBootstrap()).rejects.toThrow(/No chain config/);
      expect(evmDriver.start).not.toHaveBeenCalled();
      expect(pollDriver.start).not.toHaveBeenCalled();
    });
  });
});
