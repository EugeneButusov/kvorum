import { Command } from 'commander';
import { chDb, ConfirmationRepository, DlqRepository, pgDb } from '@libs/db';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';

type BackfillCommonOptions = {
  format?: string;
};

type BackfillStartOptions = BackfillCommonOptions & {
  fromBlock?: string;
  toBlock?: string;
  dryRun?: boolean;
};

export function registerBackfill(program: Command): void {
  const backfill = program.command('backfill').description('Backfill management');

  backfill
    .command('start <source_type>')
    .description('Start a backfill for a DAO source')
    .option('--from-block <N>', 'starting block number')
    .option('--to-block <N>', 'ending block number')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(sourceType: string, opts: BackfillStartOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const [
          {
            FailoverRpcClient,
            normalizeChainId,
            parseChainConfigFromEnv,
            silentLogger,
            consoleLogger,
          },
          compound,
          core,
        ] = await Promise.all([
          import('@libs/chain'),
          import('@sources/compound'),
          import('@sources/core'),
        ]);
        const {
          ArchiveWriter,
          createCompoundGovernorPlugin,
          EventRepository,
          makeIngesterListener,
        } = compound;
        const { BackfillAlreadyStartedError, BackfillDriver, BackfillNotResumableError } = core;

        const { daoSourceRepository } = buildContainer();
        const row = await daoSourceRepository.findBySourceTypeWithChain(sourceType);
        if (row == null) {
          fail(format, ExitCode.NotFound, `dao_source not found for source_type: ${sourceType}`);
        }
        if (row.source_type !== 'compound_governor') {
          fail(format, ExitCode.ValidationFailure, `unsupported source_type: ${row.source_type}`);
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

        const archiveWriter = new ArchiveWriter({
          eventRepo: new EventRepository({ chDb }),
          confirmationRepo: new ConfirmationRepository(pgDb),
          dlqRepo: new DlqRepository(pgDb),
          logger: silentLogger,
        });
        const dlqRepo = new DlqRepository(pgDb);
        const plugin = createCompoundGovernorPlugin({
          archiveWriter,
          dlqRepo,
          logger: silentLogger,
        });
        const parsedConfig = plugin.parseConfig(row.source_config);
        const ingestSpec = plugin.buildIngestSpec(
          {
            daoSourceId: row.id,
            sourceType: row.source_type,
            chainId: chainConfig.chainId,
            sourceLabel: row.source_type,
          },
          parsedConfig,
        );

        const rpcClient = new FailoverRpcClient(chainConfig, { logger: consoleLogger });
        await rpcClient.start();

        const status = await daoSourceRepository.readBackfillStatus(row.id);
        const mode =
          fromBlock != null
            ? 'fresh'
            : status?.backfill_started_at_block != null
              ? 'resume'
              : 'fresh';
        const resolvedFromBlock = fromBlock ?? parseBigintOrZero(row.active_from_block);

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
                filter: ingestSpec.filter,
                listenerFactory: (classifier) =>
                  makeIngesterListener(
                    {
                      archiveWriter,
                      context: {
                        daoSourceId: row.id,
                        sourceType: row.source_type,
                        chainId: chainConfig.chainId,
                        sourceLabel: row.source_type,
                        confirmationClassifier: classifier,
                      },
                      logger: silentLogger,
                      dlqRepo,
                    },
                    { onWriteFailure: 'throw' },
                  ),
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
              if (
                error instanceof BackfillAlreadyStartedError ||
                error instanceof BackfillNotResumableError
              ) {
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
    .command('status <source_type>')
    .description('Show backfill status for a DAO source')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(sourceType: string, opts: BackfillCommonOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const { daoSourceRepository } = buildContainer();
        const row = await daoSourceRepository.readBackfillStatusBySourceType(sourceType);
        if (row == null) {
          fail(format, ExitCode.NotFound, `dao_source not found for source_type: ${sourceType}`);
        }

        const payload = {
          source_type: sourceType,
          dao_source_id: row.id,
          in_progress: row.backfill_started_at_block !== null,
          backfill_started_at_block: row.backfill_started_at_block,
          backfill_head_block: row.backfill_head_block,
        };

        emit(
          format,
          () =>
            [
              `Source type: ${payload.source_type}`,
              `DAO source: ${payload.dao_source_id}`,
              `In progress: ${payload.in_progress ? 'yes' : 'no'}`,
              `Started-at block: ${payload.backfill_started_at_block ?? 'n/a'}`,
              `Head block: ${payload.backfill_head_block ?? 'n/a'}`,
            ].join('\n'),
          payload,
        );
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
