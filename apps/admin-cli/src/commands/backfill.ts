import { Command } from 'commander';
import { silentLogger } from '@libs/chain';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';
import { validateFromBlockGate } from './backfill-gate.js';
import { buildBackfillSourceRuntime } from '../plugins/backfill-source-plugins.js';

type BackfillCommonOptions = {
  format?: string;
};

type BackfillStartOptions = BackfillCommonOptions & {
  fromBlock?: string;
  toBlock?: string;
  dryRun?: boolean;
  confirmReplay?: boolean;
};

type BackfillCatchUpOptions = BackfillCommonOptions & {
  confirm?: boolean;
  dryRun?: boolean;
};

export function registerBackfill(program: Command): void {
  const backfill = program.command('backfill').description('Backfill management');

  backfill
    .command('start <source_type>')
    .description('Start a backfill for a DAO source')
    .option('--from-block <N>', 'starting block number')
    .option('--to-block <N>', 'ending block number')
    .option('--confirm-replay', 'confirm re-running blocks below current backfill head')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(sourceType: string, opts: BackfillStartOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const [
          { FailoverRpcClient, normalizeChainId, parseChainConfigFromEnv, consoleLogger },
          core,
        ] = await Promise.all([import('@libs/chain'), import('@sources/core')]);
        const { BackfillAlreadyStartedError, BackfillDriver, BackfillNotResumableError } = core;

        const { daoSourceRepository } = buildContainer();
        const row = await daoSourceRepository.findBySourceTypeWithChain(sourceType);
        if (row == null) {
          fail(format, ExitCode.NotFound, `dao_source not found for source_type: ${sourceType}`);
        }
        const fromBlock = parseOptionalBlock(opts.fromBlock, '--from-block');
        const toBlock = parseOptionalBlock(opts.toBlock, '--to-block');

        const chainConfigs = parseChainConfigFromEnv(process.env);
        const targetChainId = normalizeChainId(row.primary_chain_id);
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
          const headHex = await rpcClient.send<string>('eth_blockNumber', []);
          const head = BigInt(headHex);
          const resolvedToBlock = toBlock ?? head;
          const cutoffBlock = head - BigInt(chainConfig.reorgHorizon) * 2n;

          if (opts.dryRun === true) {
            emit(
              format,
              () =>
                [
                  `Would start backfill for ${sourceType} (dao_source ${row.id})`,
                  `Mode: ${mode}`,
                  `From block: ${resolvedFromBlock.toString()}`,
                  `To block: ${resolvedToBlock.toString()}`,
                  `Cutoff block: ${cutoffBlock.toString()}`,
                ].join('\n'),
              {
                source_type: sourceType,
                dao_source_id: row.id,
                dry_run: true,
                mode,
                from_block: resolvedFromBlock.toString(),
                to_block: resolvedToBlock.toString(),
                cutoff_block: cutoffBlock.toString(),
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
              const driver = new BackfillDriver({
                rpcClient,
                daoSourceRepo: daoSourceRepository,
                chainConfig,
                filter: sourceRuntime.filter,
                listenerFactory: sourceRuntime.listenerFactory,
                logger: progressLogger,
              });

              const outcome = await driver.run({
                daoSourceId: row.id,
                fromBlock: resolvedFromBlock,
                toBlock: toBlock ?? undefined,
                mode,
                signal: controller.signal,
              });

              if (outcome.status === 'completed') {
                await daoSourceRepository.clearBackfillState(row.id);
              }

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
    .option('--confirm', 'confirm execution (required unless --dry-run)')
    .option('--dry-run', 'show computed gap without running backfill')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(sourceType: string, opts: BackfillCatchUpOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const [
          { FailoverRpcClient, normalizeChainId, parseChainConfigFromEnv, consoleLogger },
          core,
        ] = await Promise.all([import('@libs/chain'), import('@sources/core')]);
        const { runBootCatchUp, computeGap } = core;
        const { daoSourceRepository } = buildContainer();

        const row = await daoSourceRepository.findBySourceTypeWithChain(sourceType);
        if (row == null) {
          fail(format, ExitCode.NotFound, `dao_source not found for source_type: ${sourceType}`);
        }

        const chainConfigs = parseChainConfigFromEnv(process.env);
        const targetChainId = normalizeChainId(row.primary_chain_id);
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
          const headBlock = BigInt(await rpcClient.send<string>('eth_blockNumber', []));
          const gap = computeGap({
            row: {
              active_from_block: row.active_from_block,
              backfill_head_block: row.backfill_head_block,
            },
            headBlock,
            reorgHorizon: chainConfig.reorgHorizon,
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
