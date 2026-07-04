import { Command } from 'commander';
import { normalizeChainId, silentLogger } from '@libs/chain';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';
import { validateFromBlockGate } from './backfill-gate.js';
import { runBackfillOrchestration } from './backfill-orchestrator.js';
import { runSourceBackfill } from './backfill-run-source.js';
import { runOffChainBackfillForSource, type OffChainBackfillTarget } from './offchain-backfill.js';
import { buildBackfillSourceRuntime } from '../plugins/backfill-source-plugins.js';
import { isOffChainBackfillSourceType } from '../plugins/offchain-backfill-source-plugins.js';

const DEFAULT_QUIESCENCE_TICKS = 3;
const DEFAULT_INTER_TICK_DELAY_MS = 250;

type BackfillCommonOptions = {
  format?: string;
};

type BackfillStartOptions = BackfillCommonOptions & {
  chain?: string;
  fromBlock?: string;
  toBlock?: string;
  dryRun?: boolean;
  confirmReplay?: boolean;
  // Off-chain (snapshot / discourse_forum) options:
  dao?: string;
  direct?: boolean;
  quiescenceTicks?: string;
  interTickDelay?: string;
};

type BackfillCatchUpOptions = BackfillCommonOptions & {
  chain?: string;
  confirm?: boolean;
  dryRun?: boolean;
};

type BackfillRunOptions = BackfillCommonOptions & {
  concurrency?: string;
  skipDeprecated?: boolean;
  skipLogDepthCheck?: boolean;
  dryRun?: boolean;
  direct?: boolean;
  quiescenceTicks?: string;
  interTickDelay?: string;
};

export function registerBackfill(program: Command): void {
  const backfill = program.command('backfill').description('Backfill management');

  backfill
    .command('start <source_type>')
    .description('Start a backfill for a DAO source')
    .option(
      '--chain <id>',
      'chain id (required when the source_type is registered on multiple chains)',
    )
    .option('--from-block <N>', 'starting block number (EVM sources only)')
    .option('--to-block <N>', 'ending block number (EVM sources only)')
    .option('--confirm-replay', 'confirm re-running blocks below current backfill head')
    .option('--dao <slug>', 'DAO slug (off-chain sources: disambiguates a source_type across DAOs)')
    .option(
      '--direct',
      'off-chain: write the archive in-process instead of enqueuing to the consumer',
    )
    .option(
      '--quiescence-ticks <K>',
      'off-chain: consecutive empty ticks that end the drain (default 3)',
    )
    .option('--inter-tick-delay <ms>', 'off-chain: pacing delay between polls (default 250)')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(sourceType: string, opts: BackfillStartOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        if (isOffChainBackfillSourceType(sourceType)) {
          await runOffChainStart(sourceType, opts, format);
          return;
        }
        const [
          {
            FailoverRpcClient,
            normalizeChainId,
            parseChainConfigFromEnv,
            consoleLogger,
            readConfirmedHead,
          },
          core,
        ] = await Promise.all([import('@libs/chain'), import('@sources/core')]);
        const { BackfillAlreadyStartedError, BackfillNotResumableError } = core;

        const { daoSourceRepository } = buildContainer();
        const row = await resolveSourceRow(daoSourceRepository, sourceType, opts.chain, format);
        const fromBlock = parseOptionalBlock(opts.fromBlock, '--from-block');
        const toBlock = parseOptionalBlock(opts.toBlock, '--to-block');

        const chainConfigs = parseChainConfigFromEnv(process.env);
        const targetChainId = normalizeChainId(row.chain_id);
        const chainConfig = chainConfigs.find(
          (chain) => normalizeChainId(chain.chainId) === targetChainId,
        );
        if (chainConfig == null) {
          fail(
            format,
            ExitCode.RuntimeFailure,
            `CHAIN_CONFIG does not contain chain ${targetChainId}`,
          );
        }

        let sourceRuntime;
        try {
          sourceRuntime = buildBackfillSourceRuntime({
            daoSourceId: row.id,
            sourceType: row.source_type,
            sourceConfig: row.source_config,
            chainId: chainConfig.chainId,
            logger: silentLogger,
          });
        } catch (error) {
          fail(
            format,
            ExitCode.ValidationFailure,
            error instanceof Error ? error.message : String(error),
          );
        }

        const rpcClient = new FailoverRpcClient(chainConfig, { logger: consoleLogger });
        await rpcClient.start();

        const status = await daoSourceRepository.readBackfillStatus(row.id);
        let mode: 'fresh' | 'resume' = 'fresh';
        if (fromBlock == null && status?.backfill_started_at_block != null) {
          mode = 'resume';
        }
        const resolvedFromBlock = fromBlock ?? parseBigintOrZero(row.active_from_block);
        if (fromBlock != null) {
          const violation = validateFromBlockGate({
            fromBlock,
            activeFromBlock: row.active_from_block,
            backfillHeadBlock: row.backfill_head_block,
            confirmReplay: opts.confirmReplay === true,
          });
          if (violation != null) {
            fail(format, ExitCode.ValidationFailure, violation.message);
          }
        }

        try {
          const head = BigInt(await rpcClient.send<string>('eth_blockNumber', []));
          const confirmedHead = await readConfirmedHead(rpcClient, chainConfig, row.id);
          const resolvedToBlock = toBlock ?? head;

          if (opts.dryRun === true) {
            emit(
              format,
              () =>
                [
                  `Would start backfill for ${sourceType} (dao_source ${row.id})`,
                  `Mode: ${mode}`,
                  `From block: ${resolvedFromBlock.toString()}`,
                  `To block: ${resolvedToBlock.toString()}`,
                  `Confirmed head: ${confirmedHead.toString()}`,
                ].join('\n'),
              {
                source_type: sourceType,
                dao_source_id: row.id,
                dry_run: true,
                mode,
                from_block: resolvedFromBlock.toString(),
                to_block: resolvedToBlock.toString(),
                confirmed_head: confirmedHead.toString(),
              },
            );
            return;
          }

          const progressLogger = makeProgressLogger(resolvedFromBlock, resolvedToBlock);

          await withAudit('backfill start', { sourceType, ...opts }, async () => {
            const controller = new AbortController();
            const onSignal = (signal: NodeJS.Signals) => controller.abort(signal);
            process.once('SIGINT', onSignal);
            process.once('SIGTERM', onSignal);

            try {
              const outcome = await runSourceBackfill({
                rpcClient,
                daoSourceRepo: daoSourceRepository,
                chainConfig,
                runtime: sourceRuntime,
                logger: progressLogger,
                run: {
                  daoSourceId: row.id,
                  fromBlock: resolvedFromBlock,
                  toBlock: toBlock ?? undefined,
                  mode,
                  signal: controller.signal,
                },
              });

              emit(format, () => `Backfill ${outcome.status} for ${sourceType}`, {
                source_type: sourceType,
                dao_source_id: row.id,
                ...serializeOutcome(outcome),
              });
            } catch (error) {
              if (error instanceof BackfillAlreadyStartedError) {
                fail(format, ExitCode.ValidationFailure, error.message);
              }
              if (error instanceof BackfillNotResumableError) {
                fail(format, ExitCode.ValidationFailure, error.message);
              }
              throw error;
            } finally {
              process.off('SIGINT', onSignal);
              process.off('SIGTERM', onSignal);
            }
          });
        } finally {
          await rpcClient.stop();
        }
      });
    });

  backfill
    .command('catch-up <source_type>')
    .description('Run startup-style gap fill for an existing DAO source')
    .option(
      '--chain <id>',
      'chain id (required when the source_type is registered on multiple chains)',
    )
    .option('--confirm', 'confirm execution (required unless --dry-run)')
    .option('--dry-run', 'show computed gap without running backfill')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(sourceType: string, opts: BackfillCatchUpOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const [
          {
            FailoverRpcClient,
            normalizeChainId,
            parseChainConfigFromEnv,
            consoleLogger,
            readConfirmedHead,
          },
          core,
        ] = await Promise.all([import('@libs/chain'), import('@sources/core')]);
        const { runBootCatchUp, computeGap } = core;
        const { daoSourceRepository } = buildContainer();

        const row = await resolveSourceRow(daoSourceRepository, sourceType, opts.chain, format);

        const chainConfigs = parseChainConfigFromEnv(process.env);
        const targetChainId = normalizeChainId(row.chain_id);
        const chainConfig = chainConfigs.find(
          (chain) => normalizeChainId(chain.chainId) === targetChainId,
        );
        if (chainConfig == null) {
          fail(
            format,
            ExitCode.RuntimeFailure,
            `CHAIN_CONFIG does not contain chain ${targetChainId}`,
          );
        }

        const runtime = buildBackfillSourceRuntime({
          daoSourceId: row.id,
          sourceType: row.source_type,
          sourceConfig: row.source_config,
          chainId: chainConfig.chainId,
          logger: silentLogger,
        });

        const rpcClient = new FailoverRpcClient(chainConfig, { logger: consoleLogger });
        await rpcClient.start();
        try {
          const confirmedHead = await readConfirmedHead(rpcClient, chainConfig, row.id);
          const gap = computeGap({
            row: {
              active_from_block: row.active_from_block,
              backfill_head_block: row.backfill_head_block,
            },
            confirmedHead,
          });

          if (opts.dryRun === true || opts.confirm !== true) {
            emit(format, () => `Gap check for ${sourceType}: ${renderGap(gap)}`, {
              source_type: sourceType,
              dao_source_id: row.id,
              dry_run: opts.dryRun === true,
              gap,
            });
            if (opts.dryRun !== true && opts.confirm !== true) {
              fail(format, ExitCode.ValidationFailure, 'backfill catch-up requires --confirm');
            }
            return;
          }

          await withAudit('backfill catch-up', { sourceType, ...opts }, async () => {
            const result = await runBootCatchUp({
              daoSourceId: row.id,
              chainConfig,
              rpcClient,
              daoSourceRepo: daoSourceRepository,
              runtime,
              logger: consoleLogger,
            });

            emit(format, () => `Catch-up ${result.status} for ${sourceType}`, {
              source_type: sourceType,
              dao_source_id: row.id,
              ...result,
            });
          });
        } finally {
          await rpcClient.stop();
        }
      });
    });

  backfill
    .command('run <dao_slug>')
    .description(
      'Orchestrate the full multi-chain backfill for a DAO (mainnet-first, then bounded-parallel)',
    )
    .option('--concurrency <n>', 'max concurrent sources in the parallel phase (default 3)')
    .option('--skip-deprecated', 'skip sources on deprecated chains (backfill-only)')
    .option('--skip-log-depth-check', 'skip the pre-flight eth_getLogs depth probe')
    .option('--direct', 'off-chain phase: write the archive in-process instead of enqueuing')
    .option(
      '--quiescence-ticks <K>',
      'off-chain phase: empty ticks that end each drain (default 3)',
    )
    .option('--inter-tick-delay <ms>', 'off-chain phase: pacing delay between polls (default 250)')
    .option('--dry-run', 'show the ordered plan + readiness gate without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSlug: string, opts: BackfillRunOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const concurrency = parseConcurrency(opts.concurrency);
        const controller = new AbortController();
        const onSignal = (signal: NodeJS.Signals) => controller.abort(signal);
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
        const runInput = {
          daoSlug,
          concurrency,
          skipDeprecated: opts.skipDeprecated === true,
          skipLogDepthCheck: opts.skipLogDepthCheck === true,
          dryRun: opts.dryRun === true,
          format,
          signal: controller.signal,
          offChain: {
            mode: opts.direct === true ? ('direct' as const) : ('enqueue' as const),
            quiescenceTicks: parseUnsignedOr(
              opts.quiescenceTicks,
              DEFAULT_QUIESCENCE_TICKS,
              '--quiescence-ticks',
            ),
            interTickDelayMs: parseUnsignedOr(
              opts.interTickDelay,
              DEFAULT_INTER_TICK_DELAY_MS,
              '--inter-tick-delay',
            ),
          },
        };
        try {
          if (opts.dryRun === true) {
            await runBackfillOrchestration(runInput);
          } else {
            await withAudit('backfill run', { daoSlug, ...opts }, async () => {
              await runBackfillOrchestration(runInput);
            });
          }
        } finally {
          process.off('SIGINT', onSignal);
          process.off('SIGTERM', onSignal);
        }
      });
    });
}

/**
 * Off-chain (snapshot / discourse_forum) branch of `backfill start`: resolves a single dao_source
 * (disambiguated by --dao when a source_type spans DAOs), then drains it from genesis via the poll
 * transport. `--direct` writes in-process; otherwise items enqueue to the off-chain consumer.
 */
async function runOffChainStart(
  sourceType: string,
  opts: BackfillStartOptions,
  format: OutputFormat,
): Promise<void> {
  if (opts.fromBlock != null || opts.toBlock != null) {
    fail(
      format,
      ExitCode.ValidationFailure,
      `--from-block/--to-block are not valid for off-chain source ${sourceType}`,
    );
  }

  const { daoSourceRepository } = buildContainer();
  const target = await resolveOffChainTarget(daoSourceRepository, sourceType, opts.dao, format);

  const mode = opts.direct === true ? 'direct' : 'enqueue';
  const options = {
    quiescenceTicks: parseUnsignedOr(
      opts.quiescenceTicks,
      DEFAULT_QUIESCENCE_TICKS,
      '--quiescence-ticks',
    ),
    interTickDelayMs: parseUnsignedOr(
      opts.interTickDelay,
      DEFAULT_INTER_TICK_DELAY_MS,
      '--inter-tick-delay',
    ),
  };

  if (opts.dryRun === true) {
    emit(
      format,
      () =>
        `Would drain off-chain backfill for ${sourceType} (dao_source ${target.id}), mode=${mode}, ` +
        `quiescence=${options.quiescenceTicks}`,
      { source_type: sourceType, dao_source_id: target.id, mode, dry_run: true, ...options },
    );
    return;
  }

  await withAudit('backfill start (off-chain)', { sourceType, ...opts }, async () => {
    const controller = new AbortController();
    const onSignal = (signal: NodeJS.Signals): void => controller.abort(signal);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
      const outcome = await runOffChainBackfillForSource({
        target,
        mode,
        options,
        signal: controller.signal,
        onTick: makeOffChainProgress(),
      });
      process.stderr.write('\n');
      emit(
        format,
        () =>
          `Off-chain backfill ${outcome.status} for ${sourceType} ` +
          `(${outcome.itemsProcessed} items across ${outcome.ticks} ticks)`,
        { source_type: sourceType, dao_source_id: target.id, mode, ...outcome },
      );
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  });
}

/** Resolves an off-chain source_type to a single dao_source target row (chain is always off-chain, so
 *  --chain cannot disambiguate; --dao selects among the same source_type across DAOs). */
async function resolveOffChainTarget(
  repo: ReturnType<typeof buildContainer>['daoSourceRepository'],
  sourceType: string,
  daoSlug: string | undefined,
  format: OutputFormat,
): Promise<OffChainBackfillTarget> {
  if (daoSlug != null) {
    const rows = await repo.findSourcesByDaoSlug(daoSlug);
    const row = rows.find((r) => r.source_type === sourceType);
    if (row == null) {
      fail(format, ExitCode.NotFound, `no ${sourceType} source for dao ${daoSlug}`);
    }
    return row;
  }

  const matches = await repo.findBySourceType(sourceType);
  if (matches.length === 0) {
    fail(format, ExitCode.NotFound, `dao_source not found for source_type: ${sourceType}`);
  }
  if (matches.length > 1) {
    fail(
      format,
      ExitCode.ValidationFailure,
      `source_type ${sourceType} is registered on multiple DAOs; pass --dao <slug> to select one`,
    );
  }
  const only = matches[0];
  const row = only != null ? await repo.findByIdWithChain(only.id) : null;
  if (row == null) {
    fail(format, ExitCode.NotFound, `dao_source not found for source_type: ${sourceType}`);
  }
  return row;
}

function parseUnsignedOr(value: string | undefined, fallback: number, optionName: string): number {
  if (value == null) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${optionName} must be an unsigned integer`);
  }
  return Number(value);
}

/** Single-line stderr progress for an off-chain drain (per-tick items + quiescence counter). */
function makeOffChainProgress(): (info: {
  tick: number;
  items: number;
  quiescent: number;
}) => void {
  const isTTY = process.stderr.isTTY === true;
  return ({ tick, items, quiescent }) => {
    const line = `  tick ${tick}  items ${items}  quiescent ${quiescent}`;
    process.stderr.write(isTTY ? `\r${line}          ` : `${line}\n`);
  };
}

function parseConcurrency(value: string | undefined): number {
  if (value == null) return 3;
  if (!/^\d+$/.test(value)) {
    throw new Error('--concurrency must be an unsigned integer');
  }
  const n = Number(value);
  return n > 0 ? n : 1;
}

function serializeOutcome(
  outcome:
    | { status: 'completed'; fromBlock: bigint; toBlock: bigint }
    | { status: 'cancelled'; resumeFromBlock: bigint | null }
    | { status: 'error'; error: unknown; resumeFromBlock: bigint | null },
): Record<string, unknown> {
  if (outcome.status === 'completed') {
    return {
      status: outcome.status,
      from_block: outcome.fromBlock.toString(),
      to_block: outcome.toBlock.toString(),
    };
  }
  if (outcome.status === 'cancelled') {
    return {
      status: outcome.status,
      resume_from_block: outcome.resumeFromBlock?.toString() ?? null,
    };
  }
  const err = outcome.error;
  return {
    status: outcome.status,
    resume_from_block: outcome.resumeFromBlock?.toString() ?? null,
    error: err instanceof Error ? err.message : String(err),
    ...(err instanceof Error && 'attempts' in err
      ? { attempts: (err as Record<string, unknown>)['attempts'] }
      : {}),
  };
}

export type SourceChainSelection =
  | { kind: 'ok'; id: string }
  | { kind: 'none' }
  | { kind: 'not_on_chain'; chain: string; registered: string[] }
  | { kind: 'ambiguous'; registered: string[] };

/**
 * Pure chain-aware selection of one dao_source among the rows sharing a source_type. A
 * source_type may be registered on several chains (e.g. aave_payloads_controller); `chain`
 * disambiguates. Without `chain`, a single match resolves and an ambiguous one is rejected.
 */
export function selectDaoSourceForChain(
  matches: ReadonlyArray<{ id: string; chain_id: string }>,
  chain: string | undefined,
): SourceChainSelection {
  if (matches.length === 0) {
    return { kind: 'none' };
  }
  if (chain != null) {
    const target = normalizeChainId(chain);
    const match = matches.find((m) => normalizeChainId(m.chain_id) === target);
    return match != null
      ? { kind: 'ok', id: match.id }
      : { kind: 'not_on_chain', chain: target, registered: matches.map((m) => m.chain_id) };
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', registered: matches.map((m) => m.chain_id) };
  }
  const [only] = matches;
  return only != null ? { kind: 'ok', id: only.id } : { kind: 'none' };
}

/**
 * Resolves a source_type to a single dao_source row with full backfill columns, chain-aware.
 * Exits the process via `fail` on any unrecoverable case.
 */
async function resolveSourceRow(
  repo: ReturnType<typeof buildContainer>['daoSourceRepository'],
  sourceType: string,
  chainOpt: string | undefined,
  format: OutputFormat,
) {
  const matches = await repo.findBySourceType(sourceType);
  const selection = selectDaoSourceForChain(matches, chainOpt);

  if (selection.kind === 'none') {
    fail(format, ExitCode.NotFound, `dao_source not found for source_type: ${sourceType}`);
  }
  if (selection.kind === 'not_on_chain') {
    fail(
      format,
      ExitCode.NotFound,
      `source_type ${sourceType} is not registered on chain ${selection.chain} ` +
        `(registered on: ${selection.registered.join(', ')})`,
    );
  }
  if (selection.kind === 'ambiguous') {
    fail(
      format,
      ExitCode.ValidationFailure,
      `source_type ${sourceType} is registered on multiple chains ` +
        `(${selection.registered.join(', ')}); pass --chain <id> to select one`,
    );
  }

  const row = await repo.findByIdWithChain(selection.id);
  if (row == null) {
    fail(format, ExitCode.NotFound, `dao_source not found for source_type: ${sourceType}`);
  }
  return row;
}

function parseOptionalBlock(value: string | undefined, optionName: string): bigint | undefined {
  if (value == null) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${optionName} must be an unsigned integer`);
  }
  return BigInt(value);
}

function makeProgressLogger(fromBlock: bigint, toBlock: bigint): import('@libs/chain').Logger {
  const isTTY = process.stderr.isTTY === true;
  let lineLen = 0;

  function clearLine(): void {
    if (isTTY && lineLen > 0) {
      process.stderr.write('\r' + ' '.repeat(lineLen) + '\r');
      lineLen = 0;
    }
  }

  function renderProgress(chunkEnd: bigint): void {
    const total = toBlock - fromBlock;
    if (total <= 0n) return;
    const done = chunkEnd - fromBlock + 1n;
    const pct = Math.min(100, Math.floor(Number((done * 100n) / total)));
    const width = 28;
    const filled = Math.round((width * pct) / 100);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    const line = `  [${bar}] ${String(pct).padStart(3)}%  block ${Number(chunkEnd).toLocaleString()} / ${Number(toBlock).toLocaleString()}`;
    if (isTTY) {
      process.stderr.write('\r' + line);
      lineLen = line.length;
    } else {
      process.stderr.write(line + '\n');
    }
  }

  return {
    debug: () => {},
    info: (msg: string, data?: unknown) => {
      if (msg === 'backfill_run_start') {
        process.stderr.write(
          `Backfilling blocks ${Number(fromBlock).toLocaleString()} → ${Number(toBlock).toLocaleString()}\n`,
        );
      } else if (msg === 'backfill_chunk_complete') {
        const d = data as Record<string, string>;
        renderProgress(BigInt(d['chunkEnd'] ?? '0'));
      } else if (msg === 'backfill_run_completed') {
        clearLine();
        process.stderr.write('✓ Backfill complete\n');
      }
    },
    warn: (msg: string, data?: unknown) => {
      clearLine();
      process.stderr.write(`WARN  ${msg}${data ? ' ' + JSON.stringify(data) : ''}\n`);
    },
    error: (msg: string, data?: unknown) => {
      clearLine();
      process.stderr.write(`ERROR ${msg}${data ? ' ' + JSON.stringify(data) : ''}\n`);
    },
  };
}

function parseBigintOrZero(value: string | null): bigint {
  if (value == null) {
    return 0n;
  }
  return BigInt(value);
}

function renderGap(
  gap:
    | { kind: 'gap'; gapStart: bigint; gapEnd: bigint }
    | { kind: 'none' }
    | { kind: 'skip'; reason: string },
): string {
  if (gap.kind === 'gap') return `gap ${gap.gapStart.toString()}..${gap.gapEnd.toString()}`;
  if (gap.kind === 'none') return 'no gap';
  return `skipped (${gap.reason})`;
}

async function withBackfillFormat(
  command: Command,
  opts: BackfillCommonOptions,
  run: (format: OutputFormat) => Promise<void>,
): Promise<void> {
  let format: OutputFormat = 'human';
  try {
    const globalFormat = command.optsWithGlobals()['format'];
    format = resolveFormat(
      opts.format,
      typeof globalFormat === 'string' ? globalFormat : undefined,
    );
    await run(format);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (
      message.startsWith('invalid --format value:') ||
      message.includes('must be an unsigned integer')
    ) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    fail(format, ExitCode.RuntimeFailure, 'backfill command failed', { message });
  }
}
