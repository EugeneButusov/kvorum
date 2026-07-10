import type { Generated, Insertable, Selectable } from 'kysely';

export interface AiOutputTable {
  id: Generated<string>;
  feature_name: string;
  prompt_version: string;
  input_hash: string;
  model: string;
  output: unknown; // jsonb
  cost_usd: string; // numeric(12,6) → JS string
  generated_at: Date;
  source_provenance: unknown; // jsonb — the Provenance object
}
export type AiOutput = Selectable<AiOutputTable>;
export type NewAiOutput = Insertable<AiOutputTable>;

export interface AiCostLogTable {
  id: Generated<string>;
  timestamp: Date;
  feature_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
  dao_id: string | null;
  entity_reference: string | null;
}
export type AiCostLog = Selectable<AiCostLogTable>;
export type NewAiCostLog = Insertable<AiCostLogTable>;

export interface AiDlqTable {
  id: Generated<string>;
  feature_name: string;
  prompt_version: string;
  input_hash: string;
  model: string;
  raw_output: unknown | null; // jsonb, nullable
  zod_error: unknown; // jsonb
  attempts: number;
  first_seen_at: Date;
  last_seen_at: Date;
}
export type AiDlq = Selectable<AiDlqTable>;
export type NewAiDlq = Insertable<AiDlqTable>;

// ── Declaration merging ───────────────────────────────────────────────────────
// The DDL for these tables is a core migration (libs/db/migrations/0008_ai_infra.ts);
// their Kysely types live here and merge into @libs/db's PgDatabase so repos in this
// lib type against Kysely<PgDatabase> without libs/db owning AI-specific types.
declare module '@libs/db' {
  interface PgDatabase {
    ai_output: AiOutputTable;
    ai_cost_log: AiCostLogTable;
    ai_dlq: AiDlqTable;
  }
}
