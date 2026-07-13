# ADR-079 — AI cost accounting, hard budget cap, provenance contract, and model record

- **Status**: Accepted
- **Date**: 2026-07-13
- **Spec sections affected**: 5.3, 7.8
- **Related**: ADR-078 (AI infrastructure + queue), ADR-045 (metric naming), ADR-032 (DLQ)
- **Implemented by**: #432 (`ai_cost_log` + cache + provenance), #434 (hard budget cap + `ai_worker_*` metrics)

## Context

SPEC §5.3 committed to cost tracking, a hard per-feature monthly budget cap, and provenance for AI outputs, but at the level of intent. Milestone M5-1 (#432, #434) implemented them. This ADR records the cost/cap/provenance **contract** and the **model record** (which models are used, at what price, and by which feature) so cost discipline is auditable and the caps are operable before the feature workers (M5-2) generate real spend.

Costs are the only meaningful variable operating cost of the platform (SPEC §7.8), so they are bounded programmatically, not merely observed.

## Decision

### 1. Cost ledger — `ai_cost_log`

Every **real** LLM/embedding call writes exactly one row to Postgres `ai_cost_log`:

```
ai_cost_log(
  id uuid pk, timestamp timestamptz, feature_name text, model text,
  input_tokens int, output_tokens int, cost_usd numeric(12,6),
  dao_id uuid null, entity_reference text null )
  INDEX (feature_name, timestamp)
```

**Cache hits do not write a row** — the content-hash cache (ADR-078 §4) returns early with no API call and no cost. Cost and cache-write are committed together in one transaction on a miss. This table powers per-feature / per-DAO / per-window cost analysis and the budget cap. `cost_usd` is a `numeric` read back as a JS string and parsed to `number` only at the aggregate boundary (safe: monthly caps ≤ $41, far below `2^53`).

### 2. Provenance contract

Each `ai_output` row carries `source_provenance` (jsonb) = the `Provenance` object (`libs/ai/src/llm/ports.ts`):

```ts
interface Provenance {
  feature: string;
  model: string;
  promptVersion: string;
  inputHash: string; // 'sha256:<hex>'
  generatedAt: string; // ISO-8601
}
```

Outputs are **immutable**; regeneration produces a new row (a new `(feature_name, prompt_version, input_hash)` key), never an update. Because the cache key includes `prompt_version` (ADR-078 §3) and `input_hash`, every stored output is permanently attributable to the exact prompt version, model, and input that produced it.

### 3. Hard budget cap

Each feature has a monthly USD ceiling. A **5-minute cron** (`AiBudgetCapService`, `@Interval(AI_BUDGET_CAP_MS, default 300000)`) computes, per feature, month-to-date spend (`sum(cost_usd)` where `timestamp >= start-of-current-month-UTC`) and:

- **`disabled = spendUsd >= capUsd`** (exactly-at-cap disables).
- At ≥90% it logs `ai_budget_warning`; at ≥100% it logs `ai_budget_disabled` (edge-triggered, once per transition). Alerting itself is **external**: Prometheus/Grafana alert on the `ai_worker_budget_utilization_percent` gauge.
- A disabled feature is enforced in two places (both in the single ai-worker process, so an in-memory flag is coherent): **rejected at enqueue** (the trigger scanner skips it) and **skipped at the worker** (the consumer acks without dispatching). The state is held in an in-memory `AiBudgetState` the cron writes and both paths read; it is recomputed on bootstrap so a restart does not fail-open.
- **Monthly reset is emergent**: because spend is measured from the start of the current calendar month each tick, on the 1st the month-to-date sum drops to ~0 and features re-enable automatically. There is no reset job.
- Caps are read from env **per tick**, so a **manual raise** (`AI_CAP_*_USD`) takes effect at the next tick with no restart — deliberately requiring operator intent, per SPEC §5.3.

Metrics (`ai_worker_*`, ADR-045 naming): `cost_usd`, `budget_utilization_percent`, `feature_disabled`, and `jobs_total` are recorded by M5-1; `latency_seconds`, `tokens_total`, `cache_hits_total` are defined and recorded by the M5-2 feature handlers.

### 4. Model record

Canonical v1 models and pricing (USD per **million tokens**; the pricing registries in `libs/ai/src/llm/providers/` are the source of truth):

| Model                    | Provider  | Input $/Mtok | Output $/Mtok | v1 use                                             |
| ------------------------ | --------- | ------------ | ------------- | -------------------------------------------------- |
| `claude-haiku-4-5`       | Anthropic | 1            | 5             | Proposal summarizer (batch); forum synth (default) |
| `claude-sonnet-5`        | Anthropic | 3            | 15            | Mismatch detector (sync); forum synth (escalation) |
| `claude-opus-4-8`        | Anthropic | 5            | 25            | Available in registry; no v1 feature assigned      |
| `text-embedding-3-small` | OpenAI    | 0.02         | —             | Proposal embeddings                                |

Model selection is **config-as-code**: the per-feature model is pinned in each prompt template's frontmatter (ADR-078 §3) and the pricing map lives in the provider. There is no env-based model override — swapping a feature's model is a template edit, keeping the choice versioned alongside the prompt (a new template version is a new provenance record).

### 5. Cost levers

- **Batch API** — 50% of sync cost for non-time-critical features (ADR-078 §5; orchestration M5-2).
- **Prompt caching** — Anthropic prompt caching for shared prompt prefixes (available; applied per feature in M5-2).
- **Content-hash cache** — a repeated input is free (no API call).

### 6. Default caps (env, per SPEC §5.3)

| Feature             | Env var                      | Default (USD/mo) |
| ------------------- | ---------------------------- | ---------------- |
| Proposal summarizer | `AI_CAP_SUMMARIZE_USD`       | 5                |
| Mismatch detector   | `AI_CAP_MISMATCH_USD`        | 20               |
| Forum synthesizer   | `AI_CAP_FORUM_SYNTHESIS_USD` | 15               |
| Embeddings          | `AI_CAP_EMBED_USD`           | 1                |
| **Total**           |                              | **41**           |

Caps are intentionally tight (typical spend ≈ 30% of cap); the operator should know when the system approaches them.

## Consequences

- Cost is bounded programmatically per feature, with automatic disable at 100% and automatic monthly recovery — no runaway spend, no manual monthly reset.
- Every AI output is permanently attributable to its model, prompt version, and input hash.
- Caps and model choices are inspectable config: caps in env (raise = intentional config change), models in template frontmatter + the provider pricing registry.
- Deferred to M5-2: recording `latency_seconds`/`tokens_total`/`cache_hits_total` (feature handlers + cache), batch orchestration, and prompt-caching application per feature.

## Alternatives rejected

- **Observe-only cost tracking (no hard cap):** rejected — SPEC §7.8 makes LLM spend the only meaningful variable cost; it must be bounded, not just visible.
- **Durable per-feature disabled-state table:** rejected — all enforcement paths run in one process, so an in-memory flag (recomputed on bootstrap) suffices; a table would add schema for no benefit.
- **Env-based per-feature model override:** rejected — the model is already versioned in the prompt template; a parallel env indirection would let model and prompt drift apart and break the "one version = one provenance record" property.
- **Explicit monthly-reset job:** rejected — measuring spend from start-of-month makes reset emergent, removing a scheduled job and its edge cases.
