import { sql } from 'kysely';
import { ProposalRepository, pgDb } from '@libs/db';
import { withAudit } from '../audit.js';
import { emit, type OutputFormat } from '../output.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface BackfillCandidateRow {
  id: string;
  source_id: string;
  source_type: string;
  voting_starts_block: string | null;
  primary_token_address: string;
  chain_id: string;
  voting_address: string | null;
  voting_strategy_address: string | null;
}

interface RpcClient {
  send<T = unknown>(method: string, params: unknown[]): Promise<T>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type VpFetcher = (row: BackfillCandidateRow, client: RpcClient) => Promise<bigint | null>;

// ── Query ────────────────────────────────────────────────────────────────────

export async function findCandidates(
  daoSlug: string,
  sourceType?: string,
): Promise<BackfillCandidateRow[]> {
  let query = pgDb
    .selectFrom('proposal')
    .innerJoin('dao', 'dao.id', 'proposal.dao_id')
    .innerJoin('dao_source', (join) =>
      join
        .onRef('dao_source.dao_id', '=', 'proposal.dao_id')
        .onRef('dao_source.source_type', '=', 'proposal.source_type'),
    )
    .leftJoin('aave_proposal_metadata', 'aave_proposal_metadata.proposal_id', 'proposal.id')
    .select([
      'proposal.id',
      'proposal.source_id',
      'proposal.source_type',
      'proposal.voting_starts_block',
      'dao.primary_token_address',
      'dao_source.chain_id',
      sql<string | null>`dao_source.source_config ->> 'voting_address'`.as('voting_address'),
      'aave_proposal_metadata.voting_strategy_address',
    ])
    .where('proposal.eligible_voting_power', 'is', null)
    .where('dao.slug', '=', daoSlug)
    .orderBy('proposal.created_at', 'asc');

  if (sourceType != null) {
    query = query.where('proposal.source_type', '=', sourceType);
  }

  return query.execute() as Promise<BackfillCandidateRow[]>;
}

// ── Per-source VP fetchers ───────────────────────────────────────────────────

export async function fetchCompoundVp(
  row: BackfillCandidateRow,
  client: RpcClient,
): Promise<bigint | null> {
  if (row.voting_starts_block == null) return null;

  const { encodeTotalSupplyCall, decodeTotalSupplyResult } = await import('@sources/compound');

  const blockTag = `0x${BigInt(row.voting_starts_block).toString(16)}`;
  const hex = await client.send<string>('eth_call', [
    { to: row.primary_token_address, data: encodeTotalSupplyCall() },
    blockTag,
  ]);
  return decodeTotalSupplyResult(hex);
}

export async function fetchAaveV2Vp(
  row: BackfillCandidateRow,
  client: RpcClient,
): Promise<bigint | null> {
  if (row.voting_starts_block == null || row.voting_strategy_address == null) return null;

  const { encodeTotalVotingSupplyAtCall, decodeTotalVotingSupplyAtResult } = await import(
    '@sources/aave'
  );

  const blockNumber = BigInt(row.voting_starts_block);
  const blockTag = `0x${blockNumber.toString(16)}`;
  const hex = await client.send<string>('eth_call', [
    { to: row.voting_strategy_address, data: encodeTotalVotingSupplyAtCall(blockNumber) },
    blockTag,
  ]);
  return decodeTotalVotingSupplyAtResult(hex);
}

export async function fetchAragonVp(
  row: BackfillCandidateRow,
  client: RpcClient,
): Promise<bigint | null> {
  if (row.voting_address == null) return null;

  const { encodeGetVote, decodeGetVote } = await import('@sources/lido');

  const hex = await client.send<string>('eth_call', [
    { to: row.voting_address, data: encodeGetVote(row.source_id) },
    'latest',
  ]);
  const vote = decodeGetVote(hex);
  return vote.votingPower;
}

// ── Dispatch map ─────────────────────────────────────────────────────────────

const SUPPORTED_VP_FETCHERS = new Map<string, VpFetcher>([
  ['compound_governor_bravo', fetchCompoundVp],
  ['compound_governor_alpha', fetchCompoundVp],
  ['compound_governor_oz', fetchCompoundVp],
  ['aave_governor_v2', fetchAaveV2Vp],
  ['aragon_voting', fetchAragonVp],
]);

export { SUPPORTED_VP_FETCHERS };

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
  const candidates = await findCandidates(opts.daoSlug, opts.sourceType);
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

  const pool = await buildRpcClientPool();
  const proposalRepo = new ProposalRepository(pgDb);

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

      const fetcher = SUPPORTED_VP_FETCHERS.get(row.source_type);
      if (fetcher == null) {
        skippedTypes.add(row.source_type);
        skipped++;
        continue;
      }

      try {
        const client = await pool.get(row.chain_id);
        const vp = await fetcher(row, client);

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
