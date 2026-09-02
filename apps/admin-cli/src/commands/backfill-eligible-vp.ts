import { ProposalRepository, pgDb } from '@libs/db';
import { withAudit } from '../audit.js';
import { emit, type OutputFormat } from '../output.js';
import { buildVpFetcherMap, loadEligibleVpProviders } from '../plugins/eligible-vp-providers.js';

interface RpcClient {
  send<T = unknown>(method: string, params: unknown[]): Promise<T>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ── RPC client pool ──────────────────────────────────────────────────────────

export interface RpcClientPool {
  get(chainId: string): Promise<RpcClient>;
  stopAll(): Promise<void>;
}

export async function buildRpcClientPool(): Promise<RpcClientPool> {
  const { FailoverRpcClient, normalizeChainId, parseChainConfigFromEnv, consoleLogger } =
    await import('@libs/chain');

  const chainConfigs = parseChainConfigFromEnv(process.env);
  const configByChainId = new Map(chainConfigs.map((c) => [normalizeChainId(c.chainId), c]));
  const clients = new Map<string, RpcClient>();

  return {
    async get(chainId: string): Promise<RpcClient> {
      const normalized = normalizeChainId(chainId);
      const existing = clients.get(normalized);
      if (existing != null) return existing;

      const config = configByChainId.get(normalized);
      if (config == null) throw new Error(`No chain config for ${normalized}`);

      const client = new FailoverRpcClient(config, { logger: consoleLogger });
      await client.start();
      clients.set(normalized, client);
      return client;
    },

    async stopAll(): Promise<void> {
      await Promise.all([...clients.values()].map((c) => c.stop()));
      clients.clear();
    },
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface BackfillEligibleVpOptions {
  daoSlug: string;
  sourceType?: string;
  dryRun: boolean;
  format: OutputFormat;
}

export async function runEligibleVpBackfill(opts: BackfillEligibleVpOptions): Promise<void> {
  const proposalRepo = new ProposalRepository(pgDb);
  const candidates = await proposalRepo.findEligibleVpCandidates(opts.daoSlug, opts.sourceType);
  if (candidates.length === 0) {
    emit(opts.format, () => 'No proposals with NULL eligible_voting_power found.', {
      filled: 0,
      skipped: 0,
      errored: 0,
      total: 0,
      dry_run: opts.dryRun,
    });
    return;
  }

  process.stderr.write(`Found ${candidates.length} proposal(s) with NULL eligible_voting_power.\n`);

  const providers = await loadEligibleVpProviders();
  const fetcherMap = buildVpFetcherMap(providers);
  const pool = await buildRpcClientPool();

  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let filled = 0;
  let skipped = 0;
  let errored = 0;
  const skippedTypes = new Set<string>();

  const run = async () => {
    for (const [i, row] of candidates.entries()) {
      if (controller.signal.aborted) {
        process.stderr.write('Aborted.\n');
        break;
      }

      const provider = fetcherMap.get(row.source_type);
      if (provider == null) {
        skippedTypes.add(row.source_type);
        skipped++;
        continue;
      }

      try {
        const client = await pool.get(row.chain_id);
        const ctx = {
          sourceId: row.source_id,
          votingStartsBlock: row.voting_starts_block,
          primaryTokenAddress: row.primary_token_address,
          votingAddress: row.voting_address,
          votingStrategyAddress: row.voting_strategy_address,
        };
        const vp = await provider.fetchEligibleVp(ctx, client.send.bind(client));

        if (vp == null) {
          process.stderr.write(
            `  [${i + 1}/${candidates.length}] skip ${row.id} (${row.source_type}): missing required fields\n`,
          );
          skipped++;
          continue;
        }

        if (opts.dryRun) {
          process.stderr.write(
            `  [${i + 1}/${candidates.length}] dry-run ${row.id} (${row.source_type}): ${vp.toString()}\n`,
          );
        } else {
          await proposalRepo.fillEligibleVotingPower(row.id, vp.toString());
          process.stderr.write(
            `  [${i + 1}/${candidates.length}] filled ${row.id} (${row.source_type}): ${vp.toString()}\n`,
          );
        }
        filled++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `  [${i + 1}/${candidates.length}] error ${row.id} (${row.source_type}): ${msg}\n`,
        );
        errored++;
      }
    }
  };

  try {
    if (opts.dryRun) {
      await run();
    } else {
      await withAudit(
        'backfill eligible-vp',
        { dao: opts.daoSlug, sourceType: opts.sourceType },
        run,
      );
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await pool.stopAll();
  }

  if (skippedTypes.size > 0) {
    process.stderr.write(`Skipped unsupported source types: ${[...skippedTypes].join(', ')}\n`);
  }

  emit(
    opts.format,
    () =>
      `Eligible VP backfill${opts.dryRun ? ' (dry-run)' : ''}: ${filled} filled, ${skipped} skipped, ${errored} errors (total ${candidates.length})`,
    { filled, skipped, errored, total: candidates.length, dry_run: opts.dryRun },
  );
}
