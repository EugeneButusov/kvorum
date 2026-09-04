import { chDb, DelegateDiscoveryRepository, DelegationFlowProjectionWriter } from '@libs/db';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat } from '../output.js';

export interface BackfillDelegationPowerOptions {
  daoSlug: string;
  block?: string;
  batchSize: number;
  dryRun: boolean;
  format: OutputFormat;
}

export async function runDelegationPowerBackfill(
  opts: BackfillDelegationPowerOptions,
): Promise<void> {
  const { FailoverRpcClient, parseChainConfigFromEnv, normalizeChainId, consoleLogger } =
    await import('@libs/chain');
  const { encodeGetPowerCurrentCall, decodeGetPowerCurrentResult, projectSweepVotesChanged } =
    await import('@sources/aave');

  const { daoReadRepository } = buildContainer();
  const discovery = new DelegateDiscoveryRepository(chDb);
  const writer = new DelegationFlowProjectionWriter(chDb);

  const dao = await daoReadRepository.findDaoBySlug(opts.daoSlug);
  if (!dao) {
    fail(opts.format, ExitCode.NotFound, `DAO not found: ${opts.daoSlug}`);
  }

  const delegates = await discovery.findKnownDelegateAddresses(dao.id);
  if (delegates.length === 0) {
    emit(opts.format, () => 'No known delegates found.', {
      filled: 0,
      total: 0,
      dry_run: opts.dryRun,
    });
    return;
  }

  process.stderr.write(`Found ${delegates.length} delegate(s) for ${opts.daoSlug}.\n`);

  const chainConfigs = parseChainConfigFromEnv(process.env);
  const mainnetConfig = chainConfigs.find((c) => normalizeChainId(c.chainId) === '0x1');
  if (!mainnetConfig) {
    fail(opts.format, ExitCode.RuntimeFailure, 'CHAIN_CONFIG does not contain chain 0x1');
  }

  const rpcClient = new FailoverRpcClient(mainnetConfig, { logger: consoleLogger });
  await rpcClient.start();

  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let filled = 0;
  let errored = 0;

  const run = async () => {
    const blockTag =
      opts.block != null
        ? `0x${BigInt(opts.block).toString(16)}`
        : await rpcClient.send<string>('eth_blockNumber', []);

    const blockNumber = BigInt(blockTag);
    const now = new Date();
    const { createHash } = await import('node:crypto');

    for (let i = 0; i < delegates.length; i += opts.batchSize) {
      if (controller.signal.aborted) {
        process.stderr.write('Aborted.\n');
        break;
      }

      const batch = delegates.slice(i, i + opts.batchSize);
      const results = await Promise.allSettled(
        batch.map(async (addr) => {
          const calldata = encodeGetPowerCurrentCall(addr, 0);
          const hex = await rpcClient.send<string>('eth_call', [
            { to: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', data: calldata },
            blockTag,
          ]);
          return { addr, power: decodeGetPowerCurrentResult(hex) };
        }),
      );

      const rows = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { addr, power } = result.value;
          const hash = createHash('sha256')
            .update(`${addr.toLowerCase()}:${blockNumber.toString()}`)
            .digest('hex');
          const delegationId = [
            hash.slice(0, 8),
            hash.slice(8, 12),
            hash.slice(12, 16),
            hash.slice(16, 20),
            hash.slice(20, 32),
          ].join('-');

          if (opts.dryRun) {
            process.stderr.write(
              `  [${filled + errored + 1}/${delegates.length}] dry-run ${addr}: ${power.toString()}\n`,
            );
          }

          rows.push(
            projectSweepVotesChanged(addr, power, {
              daoId: dao.id,
              delegationId,
              blockNumber: blockNumber.toString(),
              createdAt: now,
            }),
          );
          filled++;
        } else {
          const msg =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          process.stderr.write(`  error: ${msg}\n`);
          errored++;
        }
      }

      if (!opts.dryRun && rows.length > 0) {
        await writer.insertBatch(rows);
      }
    }
  };

  try {
    if (opts.dryRun) {
      await run();
    } else {
      await withAudit('backfill delegation-power', { dao: opts.daoSlug, block: opts.block }, run);
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await rpcClient.stop();
  }

  emit(
    opts.format,
    () =>
      `Delegation power backfill${opts.dryRun ? ' (dry-run)' : ''}: ${filled} filled, ${errored} errors (total ${delegates.length})`,
    { filled, errored, total: delegates.length, dry_run: opts.dryRun },
  );
}
