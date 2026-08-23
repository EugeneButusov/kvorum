# AI Budget-Cap Ops Runbook — caps, disable/re-enable, monitoring

**Scope:** the operator knobs for the AI hard budget cap (SPEC §5.3, ADR-079) — reading current spend,
lowering/raising a cap, and confirming a feature's disabled state. The **enforcement proof** (the deliberate
cap-lower → re-enable drill) lives in [`m5-acceptance.md`](m5-acceptance.md) §"AC #4"; this runbook is the
day-to-day operator reference, not the acceptance gate.

Pairs with:

- [`m5-acceptance.md`](m5-acceptance.md) — AC #3/#4 acceptance (the drill + the cost-ceiling procedure).
- [`m5-ai-backfill.md`](m5-ai-backfill.md) — the cap pauses the backfill near the ceiling.

---

## The caps

Read every cap-check tick from env; a change takes effect on the **next tick** (no code deploy). Defaults are
the SPEC §5.3 values.

| Feature             | Env var                      | Default | Path / discount  |
| ------------------- | ---------------------------- | ------- | ---------------- |
| proposal_summarizer | `AI_CAP_SUMMARIZE_USD`       | `5`     | Batch API (0.5×) |
| mismatch_detector   | `AI_CAP_MISMATCH_USD`        | `20`    | Sync Sonnet (1×) |
| forum_synthesizer   | `AI_CAP_FORUM_SYNTHESIS_USD` | `15`    | Batch API (0.5×) |
| embedding           | `AI_CAP_EMBED_USD`           | `1`     | OpenAI (flat)    |
| **Total ceiling**   |                              | **$41** |                  |

- **Cap-check interval:** `AI_BUDGET_CAP_MS` (default `300000` = 5 min).
- **Disable rule:** a feature is disabled when its **month-to-date** spend `>= cap` (exactly-at-cap disables).
  The window starts at the first of the current UTC month — the monthly reset is emergent (no cron zeroes it),
  so spend rolls to zero at the month boundary and a capped feature resumes automatically.

---

## Read current spend + disabled state

```bash
# Month-to-date spend vs caps, per feature (recomputes from ai_cost_log; [DISABLED] where spend >= cap):
admin-cli ai cost                    # alias: admin-cli ai cap show
admin-cli ai cost --format json      # machine-readable
```

The **authoritative live** disabled state is the Prometheus gauge, not the CLI (the CLI is an independent
recompute that can lag the worker inside a 5-min tick). Scrape the ai-worker ops port (`OPS_PORT`, default
9091):

```bash
$ curl -s localhost:9091/metrics | grep -E 'ai_worker_(feature_disabled|budget_utilization_percent)'
```

`ai_worker_feature_disabled{feature="…"} 1` ⇒ disabled. When the CLI and the gauge disagree, trust the gauge.
The full picture is on the Grafana dashboard `infra/k8s/components/monitoring/dashboards/ai-cost-feature-health.json`.

---

## Lower a cap (throttle a feature)

Lowering a cap below month-to-date spend disables the feature on the next tick — new jobs are rejected at
enqueue and in-flight jobs are skipped at the worker (they still ACK; see [`m5-ai-dlq-triage.md`](m5-ai-dlq-triage.md)
for why they do not hit the DLQ). This is the mechanism the AC #4 drill exercises end-to-end.

```bash
# .env is a derived artifact (ADR-028) — never hand-edit. Set the Helm/vault value, regenerate, and roll:
#   (set AI_CAP_MISMATCH_USD to the new value in the vault)
$ infra/scripts/provision-env.sh
$ admin-cli restart ai-worker
# within one AI_BUDGET_CAP_MS tick, confirm the gauge:
$ curl -s localhost:9091/metrics | grep 'ai_worker_feature_disabled{feature="mismatch_detector"}'
```

## Raise a cap (re-enable) — by design a config change

There is intentionally **no CLI to mutate a cap** (`admin-cli ai cap set` is a deliberate not-implemented
stub): raising a cap is a configuration change so every increase carries explicit operator intent (SPEC §5.3,
ADR-079). Same mechanism as lowering — set the higher value, `provision-env.sh`, `admin-cli restart ai-worker`;
the feature re-enables on the next tick. If a monthly ceiling breach is expected (e.g. a full historical
backfill), raise the ceiling **deliberately as a documented decision** (an ADR), per §7.8's escalation order:
tune caps down → audit usage → raise the ceiling as an ADR. Silent breaches are a process failure.

---

## Alerting

Prometheus/Grafana alert on `ai_worker_budget_utilization_percent{feature}`: **≥ 90% warning**, **≥ 100%
critical** (the feature auto-disables at 100%). Routing (PagerDuty/Slack/email) is deployment configuration.
