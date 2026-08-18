# M5 Acceptance Runbook — AI cost + budget cap (AC #3/#4)

**Scope:** validate the two cost-discipline acceptance criteria of M5 —
[#452](https://github.com/EugeneButusov/kvorum/issues/452) (M5-7.2). This is the operational counterpart
to the developer-level gate already enforced in CI (the budget-cap acceptance spec + the per-piece unit
specs below).

The canonical AC definitions live in [`docs/SPEC.md`](../SPEC.md) §10.7. This runbook turns each into a
copy-pasteable check with an explicit pass criterion. The budget-cap _mechanism_ (SPEC §5.3, ADR-079)
disables a feature at 100% of its monthly USD cap.

Pairs with:

- [`docs/runbooks/m3-acceptance.md`](./m3-acceptance.md) — the acceptance-runbook precedent this mirrors.
- The M5 operational backfill runbook + Grafana dashboard + monthly cost report — **deferred to
  [#453](https://github.com/EugeneButusov/kvorum/issues/453)** (M5-7.3), which also carries AC #8 + the
  retro.

> **What this ticket owns.** AC #3 (cost ceilings) and AC #4 (hard cap disables features). AC #1 (backfill
> coverage) is validated during the [#451](https://github.com/EugeneButusov/kvorum/issues/451) operator
> backfill run; AC #5 (mismatch corpus) is #441 (deferred to v1.1); AC #8 (dashboard + cost report) + the
> retro are #453.

---

## ACs at a glance

| AC  | Claim                                                                 | Primary evidence                                           | This runbook                                       |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| #3  | Monthly cost < **$41** during backfill; < **$15** in steady state     | `admin-cli ai cost` + `ai_worker_cost_usd` gauge (actuals) | [§AC #3](#ac-3--monthly-cost-under-the-ceilings)   |
| #4  | Hard budget cap disables a feature at 100% (validated by lowering it) | The budget-cap acceptance spec + the live cap-lower drill  | [§AC #4](#ac-4--hard-budget-cap-disables-features) |

Both ACs have an operator-measurement half that requires the real paid backfill (live keys/spend across
the three DAOs — the #451 operator run). AC #4's _mechanism_ is fully gated in CI; AC #3 is confirmed
against month-to-date actuals once the backfill has run. **There is no cost-projection tool** — the $15
steady-state figure is confirmed by reading settled month-to-date actuals, by design (M5-7.2 scope).

---

## Reference — caps, cost model, and where to look

**Monthly caps** (SPEC §5.3 defaults; env override read every tick, so a change takes effect on the next
cap-check tick — no code deploy needed if the process env is updated):

| Feature               | Env var                      | Default cap |
| --------------------- | ---------------------------- | ----------- |
| `proposal_summarizer` | `AI_CAP_SUMMARIZE_USD`       | $5          |
| `mismatch_detector`   | `AI_CAP_MISMATCH_USD`        | $20         |
| `forum_synthesizer`   | `AI_CAP_FORUM_SYNTHESIS_USD` | $15         |
| `embedding`           | `AI_CAP_EMBED_USD`           | $1          |
| **Total ceiling**     |                              | **$41**     |

Typical spend is ~30% of ceiling (~$12/mo) per DR-017. **Disabled rule:** `spend >= cap`
(exactly-at-cap disables). **Monthly reset** is emergent — spend is summed from `startOfCurrentMonthUtc`;
a new calendar month starts each per-feature sum at zero (no cron zeroing).

**Cost levers** (the discount is baked into `cost_usd` at booking time — there is no `batch` column in
`ai_cost_log`):

| Feature               | Path                                         | Price factor    |
| --------------------- | -------------------------------------------- | --------------- |
| `proposal_summarizer` | Anthropic **Batch API**                      | **0.5×**        |
| `forum_synthesizer`   | Anthropic **Batch API** (Haiku/Sonnet route) | **0.5×**        |
| `mismatch_detector`   | Anthropic **sync** (Sonnet)                  | 1×              |
| `embedding`           | OpenAI `text-embedding-3-small`              | flat $0.02/Mtok |

Anthropic per-Mtok pricing: `claude-haiku-4-5` $1/$5, `claude-sonnet-5` $3/$15, `claude-opus-4-8` $5/$25
(input/output). The batch 0.5× applies to bulk summary + forum (steady-state and backfill); a single-entity
`ai regenerate` / urgent-sync path books at 1×.

**Where to look:**

- **Live status + spend** — the ops server on `OPS_PORT` (default `9091`), `GET /metrics`:
  - `ai_worker_feature_disabled{feature}` — **1** if disabled by the cap, else 0 (the authoritative live
    state, from the worker's in-memory `AiBudgetState`).
  - `ai_worker_cost_usd{feature}` — month-to-date spend per feature.
  - `ai_worker_budget_utilization_percent{feature}` — spend as % of cap.
  - `ai_worker_jobs{feature,outcome}` — counter; `outcome="skipped_budget_disabled"` counts worker-skips.
- **Operator CLI** — `admin-cli ai cost` (alias `ai cap show`): prints per-feature month-to-date
  spend / cap / utilization / `[DISABLED]` + a TOTAL-vs-ceiling line. `--format json` for machine reads.

> **Caveat — two independent computations of "disabled".** `admin-cli ai cost` **recomputes** spend from
> `ai_cost_log` with its own copy of the cap map (admin-cli must not depend on the worker). The
> `ai_worker_feature_disabled` gauge is fed from the worker's live `AiBudgetState` and is **authoritative**.
> They agree except within a ~5-min tick window or if the two processes see different `AI_CAP_*` env. When
> they disagree, trust the gauge.

---

## AC #4 — Hard budget cap disables features

**Claim.** When a feature's month-to-date spend reaches its cap, it is disabled at 100%: new jobs are
rejected at enqueue, the worker stops processing them, and the status surface shows it disabled. Lowering a
cap below current spend disables the feature; raising it back re-enables it; the window resets monthly.

### Automated proof (CI gate — authoritative for the mechanism)

The cohesive drill — deliberate cap-lower → **status data + reject-at-enqueue + worker-skip** over one
shared `AiBudgetState`, then manual-raise re-enable + monthly reset:

- [`apps/ai-worker/src/budget/ai-budget-cap.acceptance.spec.ts`](../../apps/ai-worker/src/budget/ai-budget-cap.acceptance.spec.ts)
  — pure-unit, always runs (no `DATABASE_URL`).

Supporting per-piece unit specs (each proves one edge; the acceptance spec ties them together):

| Spec                                        | Proves                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `budget/ai-budget-cap.service.spec.ts`      | `spend >= cap` disables + records the gauge; per-tick env cap read (re-enable); **`describeWithDb`: real-SQL last-month exclusion** |
| `budget/ai-budget-state.spec.ts`            | fail-open default; set/reflect; detached `snapshot`                                                                                 |
| `budget/budget-config.spec.ts`              | the 4 caps + defaults + `startOfCurrentMonthUtc`                                                                                    |
| `trigger/ai-trigger-scanner.spec.ts`        | **reject-at-enqueue** — enqueues nothing when budget-disabled (per feature)                                                         |
| `consumer/ai-job.consumer.spec.ts`          | **worker-skip** — skips + records `jobs{outcome:"skipped_budget_disabled"}`                                                         |
| the 4 handler specs + 2 batch-service specs | each feature's path is inert when budget-disabled                                                                                   |

**Pass:** all green at the release SHA.

### Live operator drill (the "deliberately lowering the cap" validation)

Run against a worker with real `ai_cost_log` spend (i.e. after the #451 backfill or in steady state).

1. **Baseline.** Read current month-to-date spend and pick a feature with non-zero spend (e.g.
   `embedding`):

   ```bash
   admin-cli ai cost
   ```

2. **Deliberately lower its cap below spend.** Set the feature's `AI_CAP_*_USD` (Helm value / env) below
   its month-to-date spend and roll the worker; the new cap takes effect on the next cap-check tick
   (`AI_BUDGET_CAP_MS`, default 5 min):

   ```bash
   # e.g. embedding is at $0.80 MTD → set the cap to $0.50
   AI_CAP_EMBED_USD=0.50   # via Helm values / the worker's env, then roll the pod
   ```

3. **Confirm the disable within one tick (≤5 min):**

   ```bash
   # (a) status data — the authoritative gauge flips to 1, and the CLI shows [DISABLED]
   curl -s localhost:9091/metrics | grep 'ai_worker_feature_disabled{.*embedding'
   admin-cli ai cost        # embedding line shows [DISABLED]

   # (b) reject-at-enqueue — the trigger scanner skips the feature: no new `ai_trigger_enqueued`
   #     log lines for it and `ai_worker_job_queue_depth` for its queue stops growing.

   # (c) worker-skip — any already-queued jobs are skipped (not dispatched):
   curl -s localhost:9091/metrics | grep 'ai_worker_jobs{.*skipped_budget_disabled.*embedding'
   #     with the WARN log `ai_job_budget_disabled_skip` per skipped job (jobs still ACK — not DLQ'd).
   ```

4. **Restore the cap → re-enable.** Raise `AI_CAP_EMBED_USD` back to its normal value and roll; within one
   tick `ai_worker_feature_disabled{embedding}` returns to 0 and enqueue + processing resume. Raising a cap
   is deliberately a **configuration change** (SPEC §5.3, ADR-079) — there is **no** CLI mutation
   (`admin-cli ai cap set` is intentionally unimplemented, so a cap change always carries operator intent).

**Pass:** the gauge went 0 → 1 → 0 across the cap-lower/restore; while disabled, no new jobs of the feature
were enqueued and any queued jobs were skipped (counter climbed, jobs ACKed); the CLI `[DISABLED]` marker
tracked the gauge.

> **Monthly reset.** No action needed — the cap sums spend from `startOfCurrentMonthUtc`, so a new calendar
> month restarts each per-feature total at zero. Proven by the `describeWithDb` last-month-exclusion case in
> `ai-budget-cap.service.spec.ts` and the monthly-reset case in the acceptance spec.

---

## AC #3 — Monthly cost under the ceilings

**Claim.** Total monthly AI cost stays under the **$41** ceiling during backfill and under **$15** in steady
state.

This is an **operator measurement of month-to-date actuals** — there is no projection tool (M5-7.2 scope
decision). The tooling is `admin-cli ai cost` + the `ai_worker_cost_usd` / `ai_worker_budget_utilization_percent`
gauges (built in M5-1.5 / M5-7.1). The $15 steady-state figure lives in SPEC §10.7; it is confirmed by
reading settled actuals, not compared automatically.

### During backfill — confirm < $41

Monitor daily while the #451 backfill runs (SPEC §10.7 risk: _pause if approaching the cap_):

```bash
admin-cli ai cost
# or scrape the gauges:
curl -s localhost:9091/metrics | grep -E 'ai_worker_(cost_usd|budget_utilization_percent)'
```

**Pass:** the TOTAL month-to-date line stays **< $41** for the backfill month, and no feature is disabled
unexpectedly. (If a feature trips its cap mid-backfill, that is the cap working — the run auto-spreads across
months, or the operator temporarily raises that cap; see the #453 backfill runbook.)

### Steady state — confirm < $15

After the backfill month closes and a full steady-state calendar month accrues (new proposals triggering
features at the committed cadence, no backfill):

```bash
admin-cli ai cost
```

**Pass:** the four-feature TOTAL month-to-date is **< $15** (typical ~$12, ~30% of ceiling per DR-017).

---

## Sign-off checklist

Copy into the acceptance report; tick each AC in [#452](https://github.com/EugeneButusov/kvorum/issues/452).

- [ ] **AC #4 (automated)** — `ai-budget-cap.acceptance.spec.ts` + the supporting unit specs green at the release SHA
- [ ] **AC #4 (live drill)** — a deliberate cap-lower disabled a feature (gauge → 1, `[DISABLED]`, enqueue + worker stopped); restoring the cap re-enabled it (gauge → 0)
- [ ] **AC #4 (monthly reset)** — window confirmed to start from `startOfCurrentMonthUtc`
- [ ] **AC #3 (backfill)** — backfill-month TOTAL **< $41** (`admin-cli ai cost`)
- [ ] **AC #3 (steady state)** — a settled steady-state month TOTAL **< $15**
- [ ] Results recorded in the M5 acceptance report / #452

## Traceability

- **AC #1** (backfill coverage) → the [#451](https://github.com/EugeneButusov/kvorum/issues/451) operator backfill run.
- **AC #5** (mismatch corpus ≤ 5% FP) → #441 (deferred to v1.1) / operator.
- **AC #8** (Grafana dashboard + monthly cost-attribution report), the operational backfill runbook, and the
  M5 retro → [#453](https://github.com/EugeneButusov/kvorum/issues/453).
