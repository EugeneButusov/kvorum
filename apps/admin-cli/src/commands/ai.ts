import { Command } from 'commander';
import { PgBoss } from 'pg-boss';
import { pgDb } from '@libs/db';
import { queryCostReport, renderCostReport } from './ai-cost.js';
import { emit, emitNotImplemented, ExitCode, fail, resolveFormat } from '../output.js';

// Canonical AI feature_name → pg-boss main queue. Source of truth is the ai-worker's FEATURE_QUEUE
// (apps/ai-worker/src/queue/ai-queue-names.ts); duplicated here because admin-cli does not depend on
// the worker. `--force` (bypass the content-hash cache) is honored by the forum synthesizer today;
// other features re-run only when their input changed (an unchanged re-enqueue is a cache-hit no-op).
export const AI_REGENERATE_QUEUES: Record<string, string> = {
  proposal_summarizer: 'ai_summarize',
  mismatch_detector: 'ai_mismatch',
  forum_synthesizer: 'ai_forum_synthesis',
  embedding: 'ai_embed',
};

export interface AiRegenerateJob {
  feature: string;
  entityRef: string;
  force: boolean;
}

/** Validate the feature + entity-reference and build the (queue, job) to enqueue. Pure — the command
 *  wraps it with the pg-boss side effect. `<entity_reference>` is `<type>:<id>` (e.g.
 *  `forum_thread:<uuid>`). */
export function resolveRegenerateTarget(
  feature: string,
  ref: string,
  force: boolean,
): { queue: string; job: AiRegenerateJob } | { error: string } {
  const queue = AI_REGENERATE_QUEUES[feature];
  if (queue === undefined) {
    return {
      error: `unknown AI feature '${feature}' (expected one of ${Object.keys(AI_REGENERATE_QUEUES).join(', ')})`,
    };
  }
  if (!/^[a-z_]+:.+$/.test(ref)) {
    return {
      error: `invalid entity_reference '${ref}' (expected '<type>:<id>', e.g. forum_thread:<uuid>)`,
    };
  }
  return { queue, job: { feature, entityRef: ref, force } };
}

async function runRegenerate(
  feature: string,
  ref: string,
  opts: { force?: boolean; dryRun?: boolean; format?: string },
): Promise<void> {
  const format = resolveFormat(opts.format);
  const resolved = resolveRegenerateTarget(feature, ref, opts.force === true);
  if ('error' in resolved) {
    fail(format, ExitCode.ValidationFailure, resolved.error);
  }
  const { queue, job } = resolved;

  if (opts.dryRun) {
    emit(
      format,
      () =>
        `[dry-run] would enqueue ${feature} regenerate for ${ref}${job.force ? ' (force)' : ''}`,
      { dryRun: true, queue, job },
    );
    return;
  }

  const boss = new PgBoss({
    connectionString: process.env['DATABASE_URL'],
    schema: 'pgboss',
    migrate: false,
  });
  await boss.start();
  try {
    const id = await boss.send(queue, job);
    emit(
      format,
      () =>
        `enqueued ${feature} regenerate for ${ref}${job.force ? ' (force)' : ''} → ${id ?? '(deduped)'}`,
      { enqueued: id !== null, queue, jobId: id, job },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      fail(
        format,
        ExitCode.RuntimeFailure,
        `the '${queue}' pg-boss queue does not exist — the ai-worker must be running to create + drain it`,
        { queue },
      );
    }
    fail(format, ExitCode.RuntimeFailure, `failed to enqueue regenerate: ${message}`, { queue });
  } finally {
    await boss.stop();
  }
}

/** Report per-feature month-to-date AI spend vs the caps from `ai_cost_log` — the daily backfill-monitoring
 *  affordance (SPEC §7.8, M5-7.1). Read-only; complements the Prometheus `ai_worker_cost_usd` gauge. */
async function runCost(opts: { format?: string; dryRun?: boolean }): Promise<void> {
  const format = resolveFormat(opts.format);
  if (opts.dryRun) {
    emit(format, () => '[dry-run] would report ai_cost_log month-to-date spend per feature', {
      dryRun: true,
    });
    return;
  }
  try {
    const report = await queryCostReport(pgDb, new Date());
    emit(format, () => renderCostReport(report), report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(format, ExitCode.RuntimeFailure, `failed to read ai_cost_log: ${message}`);
  } finally {
    await pgDb.destroy().catch(() => {});
  }
}

export function registerAi(program: Command): void {
  const ai = program.command('ai').description('AI feature management');

  ai.command('cost')
    .description('Report per-feature month-to-date AI spend vs the caps (from ai_cost_log)')
    .option('--dry-run', 'show what would happen without querying')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => runCost(opts));

  ai.command('disable <feature>')
    .description('Disable an AI feature')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_feature, opts) => emitNotImplemented('ai disable', opts));

  ai.command('enable <feature>')
    .description('Enable an AI feature')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_feature, opts) => emitNotImplemented('ai enable', opts));

  const cap = ai.command('cap').description('AI spending cap management');

  cap
    .command('show')
    .description('Show per-feature caps + month-to-date spend/utilization (from ai_cost_log)')
    .option('--dry-run', 'show what would happen without querying')
    .option('--format <format>', 'output format: human or json')
    .action((opts) => runCost(opts));

  cap
    .command('set <feature> <usd>')
    .description('Set a USD spending cap for an AI feature')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_feature, _usd, opts) => emitNotImplemented('ai cap set', opts));

  ai.command('regenerate <feature> <entity_reference>')
    .description('Re-enqueue an AI feature for an entity — the SPEC §5.7 operator refresh')
    .option('--force', 'bypass the content-hash cache and overwrite (forum synthesizer)')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((feature, ref, opts) => runRegenerate(feature, ref, opts));
}
