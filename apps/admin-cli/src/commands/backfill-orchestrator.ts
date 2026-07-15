import type { ChainConfig, RpcClient } from '@libs/chain';
import type { SourceType } from '@libs/db';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat } from '../output.js';
import {
  findMissingChainConfigs,
  planBackfillOrder,
  selectBackfillMode,
  type BackfillPlan,
  type BackfillTarget,
} from './backfill-plan.js';
import { createProgressReporter } from './backfill-progress.js';
import { runSourceBackfill } from './backfill-run-source.js';
import {
  runOffChainBackfillForSource,
  type OffChainDrainOptions,
  type OffChainSinkMode,
} from './offchain-backfill.js';
import {
  buildBackfillSourceRuntime,
  buildIsBackfillable,
} from '../plugins/backfill-source-plugins.js';
import { isOffChainBackfillSourceType } from '../plugins/offchain-backfill-source-plugins.js';

export interface RunBackfillOrchestrationInput {
  daoSlug: string;
  concurrency: number;
  skipDeprecated: boolean;
  skipLogDepthCheck: boolean;
  dryRun: boolean;
  format: OutputFormat;
  signal: AbortSignal;
  /** Off-chain (snapshot / discourse_forum) phase-3 controls. */
  offChain: { mode: OffChainSinkMode } & OffChainDrainOptions;
}

interface GateFailure {
  source_type: string;
  chain: string;
  reason: string;
}

type SourceStatus = 'completed' | 'cancelled' | 'error' | 'skipped';

interface SourceOutcome {
  source_type: string;
  chain_id: string;
  status: SourceStatus;
  detail?: string;
}

/**
 * Drives the full multi-chain backfill for a DAO: enumerate sources, order them (mainnet spine
 * first, then bounded-parallel), run a pre-flight readiness gate, then backfill each source under
 * one shared AbortSignal + a per-chain RPC client pool. A readiness-gate failure aborts the whole
 * run before any writes (owner-locked); a post-gate per-source error is isolated and reported.
 */
export async function runBackfillOrchestration(
  input: RunBackfillOrchestrationInput,
): Promise<void> {
  const { format } = input;
  const {
    FailoverRpcClient,
    normalizeChainId,
    parseChainConfigFromEnv,
    consoleLogger,
    silentLogger,
    readConfirmedHead,
    probeLogDepth,
  } = await import('@libs/chain');
  const { ArchiveEventRepository, pgDb } = await import('@libs/db');

  const { daoSourceRepository } = buildContainer();
  const archiveEventRepo = new ArchiveEventRepository(pgDb);

  const rows = await daoSourceRepository.findSourcesByDaoSlug(input.daoSlug);
  if (rows.length === 0) {
    fail(format, ExitCode.NotFound, `no dao_source rows found for dao: ${input.daoSlug}`);
  }

  const plan = planBackfillOrder(rows, {
    skipDeprecated: input.skipDeprecated,
    isBackfillable: buildIsBackfillable(silentLogger),
  });
  const targets = [...plan.phase1, ...plan.phase2];
  // Off-chain sources (snapshot / discourse_forum) are excluded from the EVM plan by design; they run
  // as a serial phase 3 after the EVM spine so proposals exist before forum-link / delegation work.
  const offChainTargets = rows.filter((r) => isOffChainBackfillSourceType(r.source_type));
  if (targets.length === 0 && offChainTargets.length === 0) {
    fail(format, ExitCode.NotFound, `no backfillable sources found for dao: ${input.daoSlug}`);
  }

  // Stable [k/N] sequence numbers across the whole run, in execution order (phase1 → phase2 → off-chain).
  const seqOf = new Map<string, number>();
  for (const t of [...plan.phase1, ...plan.phase2, ...offChainTargets]) {
    seqOf.set(t.id, seqOf.size + 1);
  }
  const totalSources = seqOf.size;
  // Human progress → stderr; suppressed for --format json (machine reads stdout) and dry-run (plan only).
  const progress = createProgressReporter({ enabled: format === 'human' && !input.dryRun });

  const chainConfigs = parseChainConfigFromEnv(process.env);
  const chainConfigByChain = new Map(chainConfigs.map((c) => [normalizeChainId(c.chainId), c]));

  // Build per-source runtimes up front; a config/plugin resolution error is a gate failure.
  const runtimes = new Map<string, ReturnType<typeof buildBackfillSourceRuntime>>();
  const gateFailures: GateFailure[] = [];
  for (const t of targets) {
    const cc = chainConfigByChain.get(normalizeChainId(t.chain_id));
    if (cc == null) continue; // missing-config recorded below
    try {
      runtimes.set(
        t.id,
        buildBackfillSourceRuntime({
          daoSourceId: t.id,
          sourceType: t.source_type as SourceType,
          sourceConfig: t.source_config,
          chainId: cc.chainId,
          logger: silentLogger,
        }),
      );
    } catch (err) {
      gateFailures.push({ source_type: t.source_type, chain: t.chain_id, reason: errMessage(err) });
    }
  }

  // D9: a chain present among the targets but absent from CHAIN_CONFIG is a gate failure.
  const missingChains = new Set(findMissingChainConfigs(targets, chainConfigs));
  for (const t of targets) {
    if (missingChains.has(normalizeChainId(t.chain_id))) {
      gateFailures.push({
        source_type: t.source_type,
        chain: t.chain_id,
        reason: 'chain not present in CHAIN_CONFIG',
      });
    }
  }

  const pool = new Map<string, RpcClient & { stop(): Promise<void> }>();
  const getClient = async (cc: ChainConfig): Promise<RpcClient & { stop(): Promise<void> }> => {
    const key = normalizeChainId(cc.chainId);
    let client = pool.get(key);
    if (client == null) {
      const fresh = new FailoverRpcClient(cc, { logger: consoleLogger });
      await fresh.start();
      pool.set(key, fresh);
      client = fresh;
    }
    return client;
  };

  try {
    // D5: eth_getLogs depth probe per (reachable) source.
    if (!input.skipLogDepthCheck) {
      for (const t of targets) {
        const cc = chainConfigByChain.get(normalizeChainId(t.chain_id));
        const runtime = runtimes.get(t.id);
        if (cc == null || runtime == null) continue; // already a gate failure
        const address = filterAddress(runtime.filter.address);
        if (address == null) continue;
        const fromBlock = t.active_from_block != null ? BigInt(t.active_from_block) : 0n;
        const client = await getClient(cc);
        const result = await probeLogDepth({ rpcClient: client, address, fromBlock });
        if (!result.ok) {
          gateFailures.push({
            source_type: t.source_type,
            chain: t.chain_id,
            reason: result.reason,
          });
        }
      }
    }

    if (input.dryRun) {
      emitPlan(format, input.daoSlug, plan, offChainTargets, gateFailures, input.concurrency);
      return;
    }

    // Owner-locked: any readiness-gate failure aborts the whole run before writes.
    if (gateFailures.length > 0) {
      fail(format, ExitCode.RuntimeFailure, formatGateFailures(gateFailures));
    }

    const outcomes: SourceOutcome[] = [];
    const runOne = async (t: BackfillTarget): Promise<void> => {
      const base = { source_type: t.source_type, chain_id: t.chain_id };
      const seq = seqOf.get(t.id) ?? 0;
      const label = fmtTarget(t);
      if (input.signal.aborted) {
        progress.sourceDone(seq, totalSources, label, 'cancelled');
        outcomes.push({ ...base, status: 'cancelled' });
        return;
      }
      const cc = chainConfigByChain.get(normalizeChainId(t.chain_id));
      const runtime = runtimes.get(t.id);
      if (cc == null || runtime == null) {
        progress.sourceDone(seq, totalSources, label, 'error', 'no chain config or runtime');
        outcomes.push({ ...base, status: 'error', detail: 'no chain config or runtime' });
        return;
      }
      try {
        const client = await getClient(cc);
        const confirmedHead = await readConfirmedHead(client, cc, t.id);
        const archivedHead = await archiveEventRepo.findMaxBlockNumber(t.id);
        const mode = selectBackfillMode(t, archivedHead, confirmedHead);
        if (mode === 'skip') {
          progress.sourceDone(
            seq,
            totalSources,
            label,
            'skipped',
            'archive already at confirmed head',
          );
          outcomes.push({
            ...base,
            status: 'skipped',
            detail: 'archive already at confirmed head',
          });
          return;
        }
        const fromBlock = t.active_from_block != null ? BigInt(t.active_from_block) : 0n;
        progress.sourceStart(
          seq,
          totalSources,
          label,
          `${mode}, blocks ${fromBlock.toLocaleString('en-US')} → ${confirmedHead.toLocaleString('en-US')}`,
        );
        const outcome = await runSourceBackfill({
          rpcClient: client,
          daoSourceRepo: daoSourceRepository,
          chainConfig: cc,
          runtime,
          logger: progress.sourceLogger(seq, totalSources, label, fromBlock, confirmedHead),
          run: { daoSourceId: t.id, fromBlock, mode, signal: input.signal },
        });
        const status = outcome.status === 'completed' ? 'completed' : outcome.status;
        const detail = outcome.status === 'error' ? errMessage(outcome.error) : undefined;
        progress.sourceDone(seq, totalSources, label, status, detail);
        outcomes.push({ ...base, status, detail });
      } catch (err) {
        // Partial-failure isolation: one source failing must not abandon the rest.
        progress.sourceDone(seq, totalSources, label, 'error', errMessage(err));
        outcomes.push({ ...base, status: 'error', detail: errMessage(err) });
      }
    };

    progress.runStart(input.daoSlug, totalSources);
    if (plan.phase1.length > 0) progress.phase('Phase 1 — mainnet spine (serial)');
    for (const t of plan.phase1) {
      await runOne(t);
    }
    if (plan.phase2.length > 0) {
      progress.phase(`Phase 2 — bounded-parallel (concurrency ${Math.max(1, input.concurrency)})`);
    }
    await runWithConcurrency(plan.phase2, Math.max(1, input.concurrency), runOne);

    // Phase 3: off-chain drains, serial (each hits a rate-limited external API and is internally paced).
    if (offChainTargets.length > 0) progress.phase('Phase 3 — off-chain drains (serial)');
    for (const t of offChainTargets) {
      const base = { source_type: t.source_type, chain_id: t.chain_id };
      const seq = seqOf.get(t.id) ?? 0;
      const label = `${t.source_type}@${t.chain_id}`;
      if (input.signal.aborted) {
        progress.sourceDone(seq, totalSources, label, 'cancelled');
        outcomes.push({ ...base, status: 'cancelled' });
        continue;
      }
      progress.sourceStart(
        seq,
        totalSources,
        label,
        `off-chain drain (quiescence ${input.offChain.quiescenceTicks} ticks)`,
      );
      try {
        const outcome = await runOffChainBackfillForSource({
          target: {
            id: t.id,
            source_type: t.source_type,
            source_config: t.source_config,
            chain_id: t.chain_id,
          },
          mode: input.offChain.mode,
          options: {
            quiescenceTicks: input.offChain.quiescenceTicks,
            interTickDelayMs: input.offChain.interTickDelayMs,
          },
          signal: input.signal,
          onTick: progress.offChainTick(seq, totalSources, label),
        });
        const detail = `${outcome.itemsProcessed} items / ${outcome.ticks} ticks`;
        progress.sourceDone(seq, totalSources, label, outcome.status, detail);
        outcomes.push({ ...base, status: outcome.status, detail });
      } catch (err) {
        progress.sourceDone(seq, totalSources, label, 'error', errMessage(err));
        outcomes.push({ ...base, status: 'error', detail: errMessage(err) });
      }
    }

    emitSummary(format, input.daoSlug, outcomes);
  } finally {
    for (const client of pool.values()) {
      try {
        await client.stop();
      } catch {
        // best-effort teardown
      }
    }
  }
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

function filterAddress(address: string | string[]): string | null {
  if (typeof address === 'string') return address;
  return address.length > 0 ? (address[0] ?? null) : null;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fmtTarget(t: BackfillTarget): string {
  return `${t.source_type}@${t.chain_id}`;
}

function jsonTarget(t: BackfillTarget): Record<string, string> {
  return { source_type: t.source_type, chain_id: t.chain_id, dao_source_id: t.id };
}

function formatGateFailures(failures: readonly GateFailure[]): string {
  return [
    `readiness gate failed (${failures.length} ${failures.length === 1 ? 'issue' : 'issues'}); aborting before any writes:`,
    ...failures.map((f) => `  - ${f.source_type}@${f.chain}: ${f.reason}`),
  ].join('\n');
}

function emitPlan(
  format: OutputFormat,
  slug: string,
  plan: BackfillPlan,
  offChainTargets: readonly BackfillTarget[],
  gateFailures: readonly GateFailure[],
  concurrency: number,
): void {
  const gateLine =
    gateFailures.length === 0
      ? '  Readiness gate: PASS'
      : `  Readiness gate: FAIL\n${formatGateFailures(gateFailures)
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n')}`;
  emit(
    format,
    () =>
      [
        `Backfill plan for ${slug} (concurrency ${concurrency}):`,
        `  Phase 1 (serial): ${plan.phase1.map(fmtTarget).join(', ') || '(none)'}`,
        `  Phase 2 (parallel): ${plan.phase2.map(fmtTarget).join(', ') || '(none)'}`,
        `  Phase 3 (off-chain): ${offChainTargets.map(fmtTarget).join(', ') || '(none)'}`,
        `  Skipped (deprecated): ${plan.skippedDeprecated.map(fmtTarget).join(', ') || '(none)'}`,
        gateLine,
      ].join('\n'),
    {
      dao: slug,
      dry_run: true,
      concurrency,
      phase1: plan.phase1.map(jsonTarget),
      phase2: plan.phase2.map(jsonTarget),
      phase3_off_chain: offChainTargets.map(jsonTarget),
      skipped_deprecated: plan.skippedDeprecated.map(jsonTarget),
      gate_failures: gateFailures,
    },
  );
}

function emitSummary(format: OutputFormat, slug: string, outcomes: readonly SourceOutcome[]): void {
  const totals: Record<string, number> = {};
  for (const o of outcomes) {
    totals[o.status] = (totals[o.status] ?? 0) + 1;
  }
  emit(
    format,
    () =>
      [
        `Backfill run complete for ${slug}:`,
        ...outcomes.map(
          (o) => `  ${o.source_type}@${o.chain_id}: ${o.status}${o.detail ? ` (${o.detail})` : ''}`,
        ),
        `  totals: ${Object.entries(totals)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      ].join('\n'),
    { dao: slug, outcomes, totals },
  );
}
