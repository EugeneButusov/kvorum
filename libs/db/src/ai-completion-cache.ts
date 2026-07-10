import type { Kysely } from 'kysely';
import { AiCostLogRepository } from './ai-cost-log-repository';
import { AiOutputRepository } from './ai-output-repository';
import type { AiOutput, PgDatabase } from './schema/pg';

export interface AiOutputLookup {
  featureName: string;
  promptVersion: string;
  inputHash: string;
}

/** Intentional reshaping of #430's CompletionResult (kept free of libs/ai types). */
export interface GeneratedCompletion {
  model: string;
  output: unknown;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  sourceProvenance: unknown;
  daoId: string | null;
  entityReference: string | null;
}

export interface CacheResult {
  output: AiOutput;
  cached: boolean;
}

export class AiCompletionCache {
  private readonly outputs: AiOutputRepository;

  constructor(private readonly db: Kysely<PgDatabase>) {
    this.outputs = new AiOutputRepository(db);
  }

  async getOrGenerate(
    lookup: AiOutputLookup,
    generate: () => Promise<GeneratedCompletion>,
  ): Promise<CacheResult> {
    const hit = await this.outputs.find(lookup.featureName, lookup.promptVersion, lookup.inputHash);
    if (hit !== undefined) {
      return { output: hit, cached: true };
    }

    const g = await generate();
    // kysely@0.29 Transaction.transaction() throws (no savepoint nesting), so reuse an
    // existing transaction when handed one and only open a new one at the top level.
    const output = this.db.isTransaction
      ? await this.writeGenerated(this.db, lookup, g)
      : await this.db.transaction().execute((trx) => this.writeGenerated(trx, lookup, g));

    return { output, cached: false };
  }

  private async writeGenerated(
    db: Kysely<PgDatabase>,
    lookup: AiOutputLookup,
    g: GeneratedCompletion,
  ): Promise<AiOutput> {
    const now = new Date();
    const costUsd = String(g.costUsd);
    await new AiCostLogRepository(db).insert({
      timestamp: now,
      feature_name: lookup.featureName,
      model: g.model,
      input_tokens: g.inputTokens,
      output_tokens: g.outputTokens,
      cost_usd: costUsd,
      dao_id: g.daoId,
      entity_reference: g.entityReference,
    });
    return new AiOutputRepository(db).insert({
      feature_name: lookup.featureName,
      prompt_version: lookup.promptVersion,
      input_hash: lookup.inputHash,
      model: g.model,
      output: g.output,
      cost_usd: costUsd,
      generated_at: now,
      source_provenance: g.sourceProvenance,
    });
  }
}
