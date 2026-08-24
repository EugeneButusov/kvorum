# AI Full-History Backfill Runbook — M5-7.1

**Scope:** run the one-time full-history AI backfill (summaries, mismatch analyses, forum syntheses,
embeddings) across the indexed DAOs, under the $41/mo ceiling, resumably. This is the operator procedure for
the tooling built in **#451** (`AiBackfillService`); it is **paid** work — it requires live LLM keys and spends
real budget.

> **Restarts are safe (#617).** The in-flight Anthropic batch (`ai_batch`) and the walk cursor
> (`ai_backfill_cursor`) are durable, so a restart resumes the batch (no orphaned paid batch) and the walk
> (no re-scan from page 1) instead of losing them. Resumability is still backstopped by the content-hash
> cache (an unchanged input is a free cache hit). Final completeness is the **AC #1 coverage query** (all
> historical proposals have summaries/embeddings, etc.) plus a cheap re-run — not the cursor, because a sync
> job enqueued just before the cap trips is skipped at the worker while the cursor advances past it.

Pairs with:

- [`m5-acceptance.md`](m5-acceptance.md) — AC #1 (coverage) + AC #3 (< $41 during backfill) validation.
- [`m5-budget-cap-ops.md`](m5-budget-cap-ops.md) — the cap pauses the backfill near the ceiling.
- [`m5-ai-dlq-triage.md`](m5-ai-dlq-triage.md) — inspect/retry anything that fails during the run.

---

## Helpers

```bash
alias psql='docker compose exec -T postgres psql -U kvorum -d kvorum'
# ai-worker ops metrics (OPS_PORT default 9091):
alias aimetrics='curl -s localhost:9091/metrics'
```

---

## Config (all default OFF, read every tick)

| Env var                         | Default  | Meaning                                                    |
| ------------------------------- | -------- | ---------------------------------------------------------- |
| `AI_BACKFILL_ENABLED`           | `false`  | Master switch. Must be `true` for any feature to run.      |
| `AI_BACKFILL_SUMMARIZE_ENABLED` | `false`  | Per-feature gate (needs master too). Batch API, 0.5×.      |
| `AI_BACKFILL_FORUM_ENABLED`     | `false`  | Per-feature gate. Batch API, 0.5×.                         |
| `AI_BACKFILL_MISMATCH_ENABLED`  | `false`  | Per-feature gate. **Sync Sonnet, 1×** — the tightest cost. |
| `AI_BACKFILL_EMBED_ENABLED`     | `false`  | Per-feature gate. OpenAI, flat + cheap.                    |
| `AI_BACKFILL_DAOS`              | (all)    | Comma-separated DAO slugs to scope to; empty ⇒ all DAOs.   |
| `AI_BACKFILL_PAGE_SIZE`         | `100`    | Keyset page size per tick.                                 |
| `AI_BACKFILL_TICK_MS`           | `300000` | Backfill driver tick (5 min).                              |

The per-feature gates let you **stage** the run: the cheap 0.5× batch features (summarize, forum) and cheap
embeddings first, then the 1× mismatch run separately once you have cost headroom.

---

## Phase 1 — Prerequisites

- **Keys present.** `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` are in the vault and provisioned. Do **not** enable
  the backfill without them.
- **Caps sane for the run.** Backfilling a full corpus can approach a monthly cap. Decide up front whether to
  (a) let it auto-spread across months (it pauses at the cap and resumes next month), or (b) raise a cap
  deliberately for the backfill month (an ADR, per [`m5-budget-cap-ops.md`](m5-budget-cap-ops.md)). Mismatch
  (1× Sonnet vs the $20 cap) is the tightest.
- **Baseline the spend.** Record `admin-cli ai cost` before you start.

## Phase 2 — Stage the cheap features first

Enable master + the 0.5× batch features + embeddings, scoped to your DAOs:

```bash
#   AI_BACKFILL_ENABLED=true
#   AI_BACKFILL_SUMMARIZE_ENABLED=true
#   AI_BACKFILL_FORUM_ENABLED=true
#   AI_BACKFILL_EMBED_ENABLED=true
#   AI_BACKFILL_DAOS=compound,aave,lido
$ infra/scripts/provision-env.sh && admin-cli restart ai-worker
```

Watch it move: batch features submit to the Anthropic Batch API and persist on completion; sync features
(embedding) enqueue onto the live queues and drain through the normal handlers.

```bash
$ aimetrics | grep -E 'ai_worker_(cost_usd|budget_utilization_percent|job_queue_depth)'
admin-cli ai cost        # total climbing but under $41; no feature unexpectedly [DISABLED]
```

## Phase 3 — Run mismatch (1×) with headroom

Once summaries/forum/embeddings have settled and you have budget headroom under the $20 mismatch cap, enable
the 1× feature on its own:

```bash
#   AI_BACKFILL_MISMATCH_ENABLED=true
$ infra/scripts/provision-env.sh && admin-cli restart ai-worker
```

If the cap trips mid-run the feature pauses (an in-flight batch still drains — we already paid for it — but new
work stops); it resumes when the month rolls or you raise the cap.

## Phase 4 — Verify coverage (AC #1) and turn it off

Confirm every eligible entity now has its AI output (this is the AC #1 coverage check — the source of truth,
not the cursor). Example for summaries:

```bash
psql -c "
  SELECT count(*) AS proposals_without_summary
  FROM proposal p
  JOIN dao d ON d.id = p.dao_id
  WHERE d.slug IN ('compound','aave','lido')
    AND (p.binding OR p.source_type = 'snapshot')
    AND NOT EXISTS (
      -- ai_output is content-addressed (no proposal ref); ai_cost_log carries entity_reference.
      SELECT 1 FROM ai_cost_log c
      WHERE c.feature_name = 'proposal_summarizer' AND c.entity_reference = 'proposal:' || p.id
    )
"
```

Expected: **0** (or explained). Note this counts proposals that were _attempted_ (charged); a proposal
whose LLM output failed schema validation has a cost row but sits in `ai_dlq` with no `ai_output` — subtract
the per-feature `ai_dlq` count for true usable coverage, or count `ai_output` rows directly
(`SELECT count(*) FROM ai_output WHERE feature_name = 'proposal_summarizer'`). Non-English forum threads are
deliberately skipped. Repeat per feature.
A non-zero count means re-run the relevant feature (cache-free, so only the gaps cost anything). When coverage
is complete, **turn the backfill off** (`AI_BACKFILL_ENABLED=false`, re-provision, restart) so the driver goes
idle and only steady-state triggers run.

Record the final `admin-cli ai cost` total for the AC #3 evidence in [`m5-acceptance.md`](m5-acceptance.md).
