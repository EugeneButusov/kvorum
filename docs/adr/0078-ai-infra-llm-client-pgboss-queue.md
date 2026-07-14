# ADR-078 — AI infrastructure: LLM client, structured outputs, prompt templating, content-hash cache, and pg-boss job queue

- **Status**: Accepted
- **Date**: 2026-07-13
- **Spec sections affected**: 5.2, 5.3, 5.4, 7.1
- **Amends**: SPEC §5.3 (queue backend: BullMQ/Redis → pg-boss; structured outputs: tool-use → native `output_config`)
- **Related**: ADR-0063 (pg-boss ingestion — precedent), ADR-032 (DLQ accept semantics), ADR-045 (metric naming), ADR-079 (cost + cap + provenance)
- **Implemented by**: #430 (LLMClient), #431 (prompt templating), #432 (cache), #433 (queue + trigger bridge)

## Context

SPEC §5.3 sketched the shared AI infrastructure (`libs/ai`) but left several load-bearing choices under-specified or provisional:

- It described structured outputs as using "Anthropic's **tool-use** mechanism."
- It named **BullMQ (on Redis)** as the AI job queue, while ADR-0063 (which moved ingestion to pg-boss) explicitly **deferred the ai-worker queue choice to M5**.
- Batch-vs-sync execution, prompt templating, and the content-hash cache were described at the level of intent, not contract.

Milestone M5-1 (#430–#433) built the substrate. This ADR records the decisions as implemented so that the M5-2+ feature workers (summarizer, mismatch detector, forum synthesizer, embeddings) are thin consumers of a fixed contract.

## Decision

### 1. Provider-agnostic `LLMClient`

`libs/ai` exposes a single provider-agnostic interface (`libs/ai/src/llm/ports.ts`):

```ts
interface LLMClient {
  complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>>;
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
  submitBatch(items: FacadeBatchItem<unknown>[]): Promise<BatchHandle>;
  fetchBatch(handle: BatchHandle): Promise<ProviderBatchResult>;
}
```

The v1 backends are **Anthropic** for completions (`claude-haiku-4-5`, `claude-sonnet-5`; `claude-opus-4-8` available) and **OpenAI** for embeddings (`text-embedding-3-small`). The abstraction is deliberate: swapping either vendor is a provider change, not a feature change. See ADR-079 for the model/pricing record.

### 2. Native structured outputs + schema validation (supersedes SPEC §5.3's tool-use)

Completions use Anthropic's **native structured-output API**, not tool-use:

```ts
output_config: { format: { type: 'json_schema', schema: req.jsonSchema } }
```

Every `CompletionRequest` carries a Zod schema. The client (`llm-client.ts`) parses the provider's JSON and validates it with `schema.safeParse`. On a validation failure the request is **retried once (2 attempts total)**; if the second attempt still fails, the client raises `LlmSchemaViolationError` (carrying `feature`, `promptVersion`, `inputHash`, `model`, `rawOutput`, `zodError`, `attempts`), which the worker records to the AI DLQ (`ai_dlq`). This eliminates "LLM returned malformed JSON and crashed the worker" as a failure class.

### 3. Versioned prompt templating

Prompts are versioned frontmatter-plus-body templates under `libs/ai/src/prompts/` (one file per template). Frontmatter fields: `name`, `version`, `model` (the model is **pinned per template**), `schema` (the Zod schema label), `description`. When a template changes, its `version` is **bumped manually** (enforced by code review); new outputs reference the new version while existing outputs keep their original version, so provenance stays intact across revisions (see ADR-079).

### 4. Content-hash cache

Every AI output is cached in Postgres `ai_output`, keyed by the **UNIQUE** tuple `(feature_name, prompt_version, input_hash)`, where `input_hash` is `sha256:<hex>` of the canonical input content (`llm/provenance.ts`). This is a **correctness property, not just a cost optimization**: if the input or the prompt version changes, the key changes, the cache misses, and a fresh output is generated — stale outputs are structurally impossible. Cache-fill is idempotent (`ON CONFLICT DO NOTHING` + find-fallback). Schema and repos live in `libs/ai` (co-located with their migrations, per the `libs/sources` persistence pattern). See ADR-079 for the immutability/provenance details.

### 5. Batch-vs-sync execution mode

`CompletionRequest` carries `mode: 'sync' | 'batch'`. Anthropic's Message Batches API processes async requests at **50% of synchronous cost** and suits non-time-critical features (proposal summarization, historical forum synthesis); time-critical features (mismatch detection on active proposals) use sync mode.

**Implementation state:** the batch **API surface is implemented** (`submitBatch`/`fetchBatch` on the client + Anthropic provider). `complete()` rejects `mode: 'batch'` by design — batch work is orchestrated by the queue layer, not the per-request path. The **end-to-end batch orchestration** (the 4-hour cycle accumulating and submitting batches, then fetching results) is **deferred to M5-2** when the feature handlers exist.

### 6. Job queue = pg-boss (supersedes SPEC §5.3's BullMQ/Redis)

`apps/ai-worker` runs on **pg-boss**, the same Postgres-backed durable queue ingestion uses (ADR-0063), **not** BullMQ/Redis:

- Four feature queues — `ai_summarize`, `ai_mismatch`, `ai_forum_synthesis`, `ai_embed` — each with a `*_dlq` companion. Created DLQ-before-main; `new PgBoss({ schema: 'pgboss', migrate: false })` (verify-only start); `retryLimit: 3` + `retryBackoff: true` (SPEC §5.3's "up to 3 attempts, then dead-letter").
- **The content-hash cache (§4) is the idempotency boundary**, not pg-boss `singletonKey`. `singletonKey` + `singletonSeconds` is only an in-flight/window throttle on enqueue; a re-enqueued job that already has a cached output does no LLM work. This is the same philosophy ADR-0063 adopted (a content `ON CONFLICT` guard is the real idempotency boundary; `singletonKey` was rejected as one there too).
- A pg-boss job DLQ (`ai_job_dlq`) captures jobs that exhaust their retries — distinct from `ai_dlq` (LLM schema-violation, §2).

**Rationale:** pg-boss reuses the Postgres durability the system already requires and removes Redis as an availability dependency for AI work (a Redis outage cannot stop AI processing). This is the resolution of the choice ADR-0063 deferred.

### 7. Trigger bridge

Entity state transitions become AI jobs via a **decoupled scan** (not a write-site hook): a poller in `apps/ai-worker` reads recently-transitioned entities and enqueues, so `apps/indexer` and the framework-agnostic `libs/sources` appliers are untouched. Each trigger is behind a **per-feature env flag, default off** (`AI_TRIGGER_*_ENABLED`), so the substrate deploys inert until a feature's handler ships. Duplicate enqueues are safe (the cache is the idempotency boundary). In M5-1 only the **proposal-state → `ai_summarize`** trigger is wired; `all-actions-decoded` (mismatch) and `thread-linked` (forum synthesis) triggers land in M5-2 with their features.

## Consequences

- Postgres is the single durable substrate for both ingestion and AI queuing; no Redis for AI.
- Feature workers (M5-2+) are thin: assemble input → compute `input_hash` → `complete()`/`embed()` → the cache and cost ledger (ADR-079) do the rest.
- Free-form LLM output is impossible to ship: every completion is schema-validated, and a malformed response dead-letters rather than crashing.
- Provider swap (Anthropic/OpenAI → other) is isolated to `libs/ai/src/llm/providers`.
- Deferred to M5-2: end-to-end batch orchestration, the mismatch/forum/embedding triggers + handlers, and bootstrap wiring of the provider API keys.

## Alternatives rejected

- **BullMQ / Redis for the AI queue (SPEC §5.3 provisional):** rejected — adds a Redis availability dependency for AI work; pg-boss reuses the already-required Postgres durability, consistent with ADR-0063.
- **Tool-use for structured outputs (SPEC §5.3 wording):** superseded — Anthropic's native `output_config` json_schema format is a first-class structured-output mechanism, simpler than coercing tool-use, and still validated against Zod.
- **`singletonKey` as the idempotency guard:** rejected — it prevents duplicate enqueue within a window, not duplicate execution; the content-hash cache is the authoritative boundary (same conclusion as ADR-0063).
- **Write-site (in-transaction) enqueue for the trigger:** rejected for M5-1 — the cache makes duplicate enqueues harmless, so a decoupled scan keeps `libs/sources`/`apps/indexer` untouched.
