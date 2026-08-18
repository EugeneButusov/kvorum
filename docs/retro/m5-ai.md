# M5 — AI features · Retrospective

**Milestone:** M5 — AI features (GitHub #6)
**Scope:** Add the four AI features per SPEC §5 (proposal summaries, calldata-vs-prose mismatch detection,
forum-thread synthesis, embeddings + similarity search), the shared `libs/ai` infrastructure behind them, and
prove cost discipline at production scale (≤ $41/mo).
**Outcome:** Delivered. 7 epics (M5-1…M5-7); the M5-6/M5-7 close-out landed as #596–#601. The live paid
backfill + its AC #1/#3/#5 numbers are the operator's, by design (no keys/spend in CI).

## What shipped

| Epic | Area                          | Highlights                                                                                                                                 |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| M5-1 | AI infrastructure (`libs/ai`) | LLM client + native structured outputs, prompt templating, content-hash cache, pg-boss queue, `ai_cost_log`, hard budget cap (ADR-078/079) |
| M5-2 | Proposal summarizer           | Binding + Snapshot-signaling proposals; Batch-API bulk path + urgent sync path                                                             |
| M5-3 | Mismatch detector (flagship)  | Calldata-vs-prose methodology, surfacing threshold, `ai_mismatch_flag` (ADR-080); eval corpus deferred                                     |
| M5-4 | Forum synthesizer             | Haiku↔Sonnet auto-routing, non-English skip, exposed as a proposal sub-resource (ADR-0088)                                                |
| M5-5 | Embeddings + similarity       | `proposal_embedding` on pgvector, stable change-controlled composition (ADR-081), `/similar` endpoint                                      |
| M5-6 | API AI-output exposure        | `/ai/summary` + `/ai/mismatch` endpoints, embedded flags, OpenAPI + §5.2 trust-posture sweep                                               |
| M5-7 | Backfill + cost + operability | Full-history backfill tooling (#451), cost/budget-cap acceptance (#452), dashboard + report + runbooks + this retro (#453)                 |

## Key decisions (and their ADRs)

- **Content-hash cache as the universal idempotency primitive** (ADR-078) — `ai_output (feature, prompt_version,
input_hash)` + `proposal_embedding (proposal_id, embedding_version)`. Backfill, `ai regenerate`, and
  prompt/model version bumps are all "cache-hit no-op unless the input changed," with no bespoke progress state.
- **Hard budget cap = one recompute, enforced at two choke points** (ADR-079) — a 5-min tick sums month-to-date
  `ai_cost_log` and sets an in-memory `disabled` flag; enforced at enqueue (trigger scanner) and at consume
  (worker). `ai_worker_feature_disabled` is the authoritative live surface. Manual raise is deliberately a
  config change, not a CLI mutation.
- **Batch API 0.5× baked into cost at booking time** — summary + forum go through the batch path; the discount
  lives in the pricing layer, so cost discipline is automatic rather than a caller concern.
- **Mismatch as the flagship, Sonnet + a surfacing threshold** (ADR-080, DR-012/DR-013) — reasoning quality over
  cost for the one feature whose false positives erode trust.
- **Cost ceiling $41/mo, ~30% typical** (DR-017) — tight caps ($5/$20/$15/$1); a breach is a documented ADR, not
  an operational surprise.

## What went well

- **The build-tooling / operator-runs split held all the way through.** Every paid or prod-dependent step (the
  backfill run, the live $41/$15 numbers, the cap-lower drill) was cleanly separated from buildable,
  fake-testable code + docs. M5 shipped fully green in CI with **no real keys and no spend** — the constraint
  we held from day one.
- **The cache made "re-run" free.** Resumability, regeneration, and version bumps all reduce to the same
  cache-hit-no-op, so the backfill needed no persisted cursor for correctness and the AC #4 acceptance spec
  could compose the real services around one shared budget state.
- **Consistent cadence** — one task → one PR → four gates → CI, with each epic's acceptance proven by a
  deterministic suite before the operator ever touches a key.

## What was harder — lessons

- **The terminal-outcome metric was missing until the dashboard needed it.** The consumer counted only a
  de-facto `dispatched` on success; `succeeded`/`failed` were added in M5-7.3 so the success/failure panel could
  exist. _Lesson: define the terminal-outcome metric when you build the consumer, not when you build the
  dashboard._
- **Daily spend isn't a natural series.** Cost is a month-to-date gauge, so "daily spend per feature" is derived
  as `delta(...[24h])` with a month-boundary dip. _Lesson: decide a cost metric's time-grain before a panel
  depends on it._
- **The mismatch eval corpus needs real labeled data + paid calls.** The scoring harness shipped (M5-3.3) but
  validating the 5% false-positive target (AC #5) is operator/data work; #441 was parked (PR #587 closed) for
  v1.1. _Lesson: separate "can we build the evaluator" from "can we run the evaluation" up front._
- **Two DLQ surfaces, no `ai dlq` CLI.** Schema-validation (`ai_dlq`) and job-exhaustion (`ai_job_dlq`) are
  distinct; triage is raw SQL + `ai regenerate`. KNOWN-030: `ai_job_dlq.attempts` is hardcoded 0 and a transient
  PG failure during the bridge insert can silently drop a record. _Lesson: a unified AI-DLQ inspection command
  is worth building._
- **"Emailed" implied app code it never needed.** The cost report's delivery + external-billing ingestion don't
  exist in-repo; SPEC frames alert/email routing as deployment-config, so the report generates and delivery is
  the operator's. Correct, but the AC wording read as application scope.

## Deferred / follow-ups

- **Live AC #1 / #3 / #5** — backfill coverage, the real $41/$15 numbers, and the mismatch corpus ≤ 5% FP all
  await the operator's paid backfill; procedures are in [`m5-acceptance.md`](../runbooks/m5-acceptance.md) +
  [`m5-ai-backfill.md`](../runbooks/m5-ai-backfill.md).
- **Mismatch eval corpus** (#441 → v1.1; branch `feat/m5-3.3-mismatch-corpus` parked).
- **`ai dlq` inspection CLI + KNOWN-030** — unified inspect/retry; fix `attempts` + the silent-loss window.
- **Cost report delivery** — external-billing-API ingestion (Hetzner/AWS) + the monthly email/cron wiring
  (deployment-config today).
- **Persisted `ai_backfill_progress`** — restart-without-rescan + a progress %; optional, deferred in #451.

## Acceptance

M5 CI is green across the deterministic gates. The budget-cap disable (AC #4) is proven by the cohesive
cap-lower acceptance spec (`ai-budget-cap.acceptance.spec.ts`, runs in CI) and documented as an operator drill
in [`m5-acceptance.md`](../runbooks/m5-acceptance.md); the cost ceiling (AC #3) has its confirmation procedure
there. AC #8 (the Grafana dashboard + the monthly cost-attribution report) ships in M5-7.3. Live AC #1/#3/#5 —
the ones that require real spend on real data — await the operator backfill and are captured in the runbook set.
