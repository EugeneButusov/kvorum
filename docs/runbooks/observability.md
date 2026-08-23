# Runbook — Observability (self-hosted Grafana + Prometheus)

Cost and health monitoring for the kvorum backend. Self-hosted in-cluster: a small **Prometheus**
scrapes the apps' metrics and a stateless **Grafana** file-provisions the datasource + dashboards.
Metrics never leave the cluster — no Grafana Cloud account, token, or `remote_write`.

## Architecture

```
kvorum-api / kvorum-indexer / kvorum-ai-worker   (each exposes :9091/metrics)
        │  Prometheus pod-SD scrape (every 30s)
        ▼
kvorum-prometheus  (ClusterIP :9090, 15d retention on a 10Gi PVC)
        │  provisioned datasource (uid: prometheus)
        ▼
kvorum-grafana  (ClusterIP :80→3000)  ──tunnel──►  https://grafana.kvorum.watch
```

- All three backend processes emit **Prometheus text** on the ops port `:9091` (`OpsServer`).
  `renderMetrics()` adds no `service` label, so Prometheus stamps `job` (from
  `app.kubernetes.io/name`) and `instance` (pod name); the metric-name prefix
  (`ai_worker_`/`api_`/`indexer_`) also separates the processes.
- `indexer` and `ai-worker` have no Service, so discovery is **by pod** (not endpoints), restricted
  to the `kvorum` namespace — see `components/monitoring/prometheus-config.yaml`.
- Everything lives in the Kustomize **component** `infra/k8s/components/monitoring/`, wired into the
  prod overlay's `components:` list. It is not in `base/` (monitoring is a per-environment concern).

## Dashboards (as code)

Committed JSON under `infra/k8s/components/monitoring/dashboards/`:

- `ai-cost-feature-health.json` — per-feature month-to-date spend, total vs the **$17** ceiling,
  budget-cap utilization, disabled-state, job success/failure, p95 latency, queue/DLQ depth, cache
  hits, token throughput.
- `platform-health.json` — scrape liveness, API request rate / p95 / 5xx / rate-limit rejections,
  indexer RPC volume + failures + provider/ingestion/derivation lag, active sources.

A `configMapGenerator` turns the JSON into a **hashed** ConfigMap mounted at
`/var/lib/grafana/dashboards`, and a dashboard-provider (`grafana-provisioning.yaml`) tells Grafana
to load that directory. To add or edit a dashboard: change the JSON, add it to the generator's
`files:` list if new, and redeploy — the hash change rolls Grafana and the dashboard reloads. (The
JSON lives inside the component, not `infra/grafana-dashboards/`, because the kustomize
load-restrictor forbids a generator from reading files outside its own directory.)

## One-time setup

1. **Grafana admin password** into `kvorum-secrets` (merge-patch preserves the other keys):
   ```bash
   cat > /tmp/gf.json <<'EOF'
   {"stringData":{"GRAFANA_ADMIN_PASSWORD":"<openssl rand -base64 24>"}}
   EOF
   kubectl -n kvorum patch secret kvorum-secrets --type merge --patch-file /tmp/gf.json && rm /tmp/gf.json
   ```
2. **Cloudflare Tunnel hostname** — in the Zero Trust dashboard add a public hostname route
   `grafana.kvorum.watch` → `http://kvorum-grafana.kvorum:80`. Same single connector as the
   api/dashboard routes; no manifest change. (Optionally protect it with Cloudflare Access.)

## Deploy

Monitoring ships with the normal deploy (`apply -k` includes the component). It is **not** gated in
`deploy.yml` — a monitoring problem must never block an app rollout. If Grafana was deployed before
the password secret existed it crash-loops; after step 1, `kubectl -n kvorum rollout restart
deploy/kvorum-grafana`.

## Verify

```bash
kubectl -n kvorum get pods -l app.kubernetes.io/part-of=kvorum | grep -E 'prometheus|grafana'
# targets UP:
kubectl -n kvorum port-forward svc/kvorum-prometheus 9090:9090
#   → open http://localhost:9090/targets  (kvorum-api/indexer/ai-worker = UP)
#   → query ai_worker_cost_usd  (returns series once the ai-worker has spent)
```

Then browse `https://grafana.kvorum.watch` (user `admin` + the password) — both dashboards appear
under Dashboards and populate against the auto-provisioned Prometheus datasource.

## Capacity

Prometheus (req 150m/256Mi) + Grafana (req 100m/128Mi) fit the 2× `s-1vcpu-2gb` pool for demo-level
load. If either pod is `Pending` on memory (e.g. while the api HPA is bursting), apply the
`deployment.md` scale-up: add one `s-1vcpu-2gb` node (~+$12/mo) or bump the pool to `s-2vcpu-4gb`.
The Prometheus PVC is ~$1/mo of DO block storage.

## Editing the scrape config

`components/monitoring/prometheus-config.yaml` is a plain ConfigMap, so a change needs
`kubectl -n kvorum rollout restart deploy/kvorum-prometheus` to take effect.
