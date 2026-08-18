# AI Model / Prompt-Version Bump Runbook

**Scope:** how to safely change a prompt, a schema, or a model for an AI feature — and understand exactly what
re-generates (and what it costs) when you do. The content-hash cache keys on the **version**, so a bump is the
lever that re-runs the corpus.

Pairs with:

- [`m5-ai-backfill.md`](m5-ai-backfill.md) — a version bump is effectively a corpus re-run; stage it like a backfill.
- [`m5-budget-cap-ops.md`](m5-budget-cap-ops.md) — the re-run spends real budget and can trip a cap.

---

## Where versions + models live

Prompt features are Markdown templates with YAML frontmatter in `libs/ai/src/prompts/*.md`:

| Template file                      | `version:` | `model:`           | feature             |
| ---------------------------------- | ---------- | ------------------ | ------------------- |
| `proposal-summarizer.md`           | `v1.0`     | `claude-haiku-4-5` | proposal_summarizer |
| `proposal-summarizer-signaling.md` | `v1.0`     | `claude-haiku-4-5` | proposal_summarizer |
| `forum-synthesizer.md`             | `v1.0`     | `claude-haiku-4-5` | forum_synthesizer   |
| `mismatch-detector.md`             | `v1.0`     | `claude-sonnet-5`  | mismatch_detector   |

Embeddings are **not** a prompt template — the version is a code constant `EMBEDDING_VERSION`
(`text-embedding-3-small/v1`) in `libs/ai/src/schemas/proposal-embedding-input.ts`.

Model pricing lives in `libs/ai/src/llm/providers/anthropic-provider.ts` (`ANTHROPIC_PRICING`) and
`openai-embedding-provider.ts`. Forum model routing (Haiku↔Sonnet) is `libs/ai/src/forum-model-routing.ts`.

---

## The cache-invalidation contract (read before bumping)

- **Completions** cache on `ai_output (feature_name, prompt_version, input_hash)`. Bumping the template
  `version:` changes `prompt_version` → every lookup misses under the new tuple → the whole corpus regenerates
  on the next trigger/backfill scan. **Old rows are not deleted** (the read APIs serve the latest version).
- **Embeddings** cache on `proposal_embedding (proposal_id, embedding_version)`. Bumping `EMBEDDING_VERSION`
  re-embeds the whole corpus. A **golden test enforces** that any edit to the embedding input composition
  bumps `EMBEDDING_VERSION` (ADR-081) — so you cannot silently change embedding inputs.
- **The cache key excludes `model:`.** Changing only the model on a template does **not** invalidate the cache
  (an unchanged input stays a hit on the old output). If you want the new model to actually re-generate, **bump
  `version:` too**.

---

## Procedure

### A prompt or schema change (summarizer / mismatch / forum)

1. Edit the template body (and/or its `schema`). Bump `version:` (e.g. `v1.0` → `v1.1`).
2. If a schema field changed, update the matching Zod schema in `libs/ai/src/schemas/` and its tests.
3. `pnpm -w typecheck && pnpm lint` and run the feature's unit specs.
4. Ship it. On deploy, the steady-state trigger scanner will regenerate touched entities as they qualify; to
   regenerate the **full history** at once, run the backfill for that feature
   ([`m5-ai-backfill.md`](m5-ai-backfill.md)) or `admin-cli ai regenerate <feature> <entity_reference>` per
   entity.

### A model change

1. Ensure the new model id is present in `ANTHROPIC_PRICING` (an unpriced model **throws at completion time**).
   Add its input/output $/MTok if new.
2. Set `model:` in the template **and bump `version:`** (else the cache never re-runs on the new model).
3. Re-check the routing/latency assumptions: the forum synthesizer routes Haiku↔Sonnet by size/contentiousness
   (`chooseForumModel`); mismatch is Sonnet for reasoning quality; the p95-latency dashboard panel tops out at
   the 60s bucket.

### An embedding-input change

1. Edit the composition, **bump `EMBEDDING_VERSION`** (the golden test fails otherwise), update the golden test.
2. Re-embedding the corpus is a full re-run — stage it via the embedding backfill.

---

## Cost + budget awareness

A version bump re-generates the corpus, i.e. a **spend spike**. It is subject to the budget cap exactly like a
backfill: at 100% of the feature cap the re-run pauses and resumes next month (or after you raise the cap as a
documented decision). For a large corpus, bump during a low-spend window and monitor `admin-cli ai cost` +
`ai_worker_budget_utilization_percent` as it drains. Prefer the 0.5× Batch API path (summarizer/forum backfill)
over per-entity sync `ai regenerate` for bulk re-runs.
