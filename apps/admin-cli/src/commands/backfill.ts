import { Command } from 'commander';
import { chDb, ConfirmationRepository, DlqRepository, pgDb } from '@libs/db';
import { buildContainer } from '../bootstrap.js';
import {
  emit,
  emitNotImplemented,
  ExitCode,
  fail,
  type OutputFormat,
  resolveFormat,
} from '../output.js';

type BackfillCommonOptions = {
  format?: string;
};

type BackfillStartOptions = BackfillCommonOptions & {
  fromBlock?: string;
  toBlock?: string;
  dryRun?: boolean;
};

type BackfillCancelOptions = BackfillCommonOptions & {
  dryRun?: boolean;
};

export function registerBackfill(program: Command): void {
  const backfill = program.command('backfill').description('Backfill management');

  backfill
    .command('start <dao_source_id>')
    .description('Start a backfill for a DAO source')
    .option('--from-block <N>', 'starting block number')
    .option('--to-block <N>', 'ending block number')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: BackfillStartOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const [
          { FailoverRpcClient, normalizeChainId, parseChainConfigFromEnv, silentLogger },
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
        const row = await daoSourceRepository.findByIdWithChain(daoSourceId);
        if (row == null) {
          fail(format, ExitCode.NotFound, `dao_source not found: ${daoSourceId}`);
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

        const rpcClient = new FailoverRpcClient(chainConfig, { logger: silentLogger });
        await rpcClient.start();

        const status = await daoSourceRepository.readBackfillStatus(daoSourceId);
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
                  `Would start backfill for ${daoSourceId}`,
                  `Mode: ${mode}`,
                  `From block: ${resolvedFromBlock.toString()}`,
                  `To block: ${resolvedToBlock.toString()}`,
                  `Cutoff block: ${cutoffBlock.toString()}`,
                ].join('\n'),
              {
                dao_source_id: daoSourceId,
                dry_run: true,
                mode,
                from_block: resolvedFromBlock.toString(),
                to_block: resolvedToBlock.toString(),
                cutoff_block: cutoffBlock.toString(),
              },
            );
            return;
          }

          await daoSourceRepository.clearCancel(daoSourceId);

          const controller = new AbortController();
          const onSigint = () => controller.abort('sigint');
          process.on('SIGINT', onSigint);

          const pollTimer = setInterval(async () => {
            try {
              const current = await daoSourceRepository.readBackfillStatus(daoSourceId);
              if (current?.backfill_cancel_requested_at != null) {
                controller.abort('cancel_requested');
              }
            } catch {
              // Keep polling even if one read fails.
            }
          }, 1000);

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
              logger: silentLogger,
            });

            const outcome = await driver.run({
              daoSourceId,
              fromBlock: resolvedFromBlock,
              toBlock: toBlock ?? undefined,
              mode,
              signal: controller.signal,
            });

            if (outcome.status === 'completed') {
              await daoSourceRepository.clearBackfillState(daoSourceId);
            }

            emit(format, () => `Backfill ${outcome.status} for ${daoSourceId}`, {
              dao_source_id: daoSourceId,
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
            clearInterval(pollTimer);
            process.off('SIGINT', onSigint);
            await daoSourceRepository.clearCancel(daoSourceId);
          }
        } finally {
          await rpcClient.stop();
        }
      });
    });

  backfill
    .command('status <dao_source_id>')
    .description('Show backfill status for a DAO source')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: BackfillCommonOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const { daoSourceRepository } = buildContainer();
        const row = await daoSourceRepository.readBackfillStatus(daoSourceId);
        if (row == null) {
          fail(format, ExitCode.NotFound, `dao_source not found: ${daoSourceId}`);
        }

        const payload = {
          dao_source_id: row.id,
          in_progress: row.backfill_started_at_block !== null,
          backfill_started_at_block: row.backfill_started_at_block,
          backfill_head_block: row.backfill_head_block,
          cancel_requested_at: row.backfill_cancel_requested_at?.toISOString() ?? null,
        };

        emit(
          format,
          () =>
            [
              `DAO source: ${payload.dao_source_id}`,
              `In progress: ${payload.in_progress ? 'yes' : 'no'}`,
              `Started-at block: ${payload.backfill_started_at_block ?? 'n/a'}`,
              `Head block: ${payload.backfill_head_block ?? 'n/a'}`,
              `Cancel requested at: ${payload.cancel_requested_at ?? 'n/a'}`,
            ].join('\n'),
          payload,
        );
      });
    });

  backfill
    .command('cancel <dao_source_id>')
    .description('Cancel an in-progress backfill')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: BackfillCancelOptions) {
      await withBackfillFormat(this, opts, async (format) => {
        const { daoSourceRepository } = buildContainer();
        const status = await daoSourceRepository.readBackfillStatus(daoSourceId);
        if (status == null) {
          fail(format, ExitCode.NotFound, `dao_source not found: ${daoSourceId}`);
        }
        if (status.backfill_started_at_block == null) {
          fail(format, ExitCode.ValidationFailure, 'backfill is not in progress');
        }

        if (opts.dryRun === true) {
          emit(
            format,
            () => `Would request cancellation for in-progress backfill on ${daoSourceId}`,
            { dao_source_id: daoSourceId, dry_run: true, action: 'request_cancel' },
          );
          return;
        }

        await daoSourceRepository.requestCancel(daoSourceId);
        emit(format, () => `Cancellation requested for in-progress backfill on ${daoSourceId}`, {
          dao_source_id: daoSourceId,
          cancel_requested: true,
        });
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
  return {
    status: outcome.status,
    resume_from_block: outcome.resumeFromBlock?.toString() ?? null,
    error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
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
