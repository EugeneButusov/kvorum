# Runbook — Production deployment (DOKS)

Deploys the backend (`api` + `indexer`) to DigitalOcean Kubernetes. Target ≈ **$50/mo**.

## Topology

```
Cloudflare (TLS/DDoS) ──tunnel──► kvorum-api  Service ─► api pods    (node A)
                                                          indexer pod (node B)   ← hard split (pod anti-affinity)
External (via kvorum-secrets):  Elestio ClickHouse · DO Managed Postgres · Upstash Redis · Alchemy RPC
```

| Piece      | Choice                                     | ~ / mo         |
| ---------- | ------------------------------------------ | -------------- |
| Cluster    | DOKS, free control plane, 2× `s-1vcpu-2gb` | $24            |
| ClickHouse | Elestio managed (external)                 | $11            |
| Postgres   | DO Managed Postgres 18 (external)          | $15            |
| Redis      | Upstash (rate-limiter only)                | $0 (free tier) |
| Ingress    | Cloudflare Tunnel (`cloudflared` pod)      | $0             |
| **Total**  |                                            | **~$50**       |

- `api` scales horizontally (HPA). `indexer` is a **hard singleton** — `replicas: 1`, `Recreate`, never HPA'd (its chain pollers aren't leader-elected).
- api and indexer never share a node (required pod anti-affinity), so indexer CPU bursts can't degrade API latency.

## One-time setup

1. **Cluster** — create a DOKS cluster with a 2-node `s-1vcpu-2gb` pool. Note the cluster name.
2. **Postgres** — create a DO Managed Postgres 18 DB; grab its `DATABASE_URL` (`sslmode=require`).
3. **ClickHouse** — create an Elestio ClickHouse service **in the same region** as DOKS (keeps the write/read hop ~1–5 ms). Note host/user/password; create the `kvorum` database.
4. **Redis** — create an Upstash Redis DB; grab the `rediss://` URL.
5. **Cloudflare Tunnel** — in the Zero Trust dashboard create a tunnel, route your hostname to `http://kvorum-api.kvorum:80`, and copy the connector **token**.
6. **In-cluster secret** — create `kvorum-secrets` from the keys documented in
   [`infra/k8s/overlays/prod/secret.example.yaml`](../../infra/k8s/overlays/prod/secret.example.yaml).
   Values live **only** in the cluster — never commit them.
   ```bash
   kubectl create namespace kvorum
   kubectl -n kvorum create secret generic kvorum-secrets \
     --from-literal=DATABASE_URL='...' \
     --from-literal=CLICKHOUSE_URL='https://...:8443' \
     # ...all keys from secret.example.yaml...
     --from-literal=TUNNEL_TOKEN='...'
   ```
7. **GitHub `production` environment** (Settings → Environments) — used by `.github/workflows/deploy.yml`:
   - Secret `DIGITALOCEAN_ACCESS_TOKEN` — a scoped DO API token (read + Kubernetes).
   - Variable `DOKS_CLUSTER` — the cluster name from step 1.

   This DO token is the **only** credential CI holds. No app secret is ever exposed to GitHub.

## Deploying

**Automatic** — merge to `main`. `deploy.yml` builds the image → pushes to GHCR → runs the migration Job and waits (a failed migration aborts the deploy) → rolls api + indexer to the new tag → waits for rollout.

**Manual first deploy / from a laptop:**

```bash
IMG=ghcr.io/<owner>/kvorum:$(git rev-parse HEAD)   # after the build workflow pushed it
kubectl -n kvorum delete job kvorum-migrate --ignore-not-found
sed "s#ghcr.io/kvorum/kvorum:latest#$IMG#" infra/k8s/base/migrate-job.yaml | kubectl -n kvorum apply -f -
kubectl -n kvorum wait --for=condition=complete job/kvorum-migrate --timeout=300s
cd infra/k8s/overlays/prod
kustomize edit set image ghcr.io/kvorum/kvorum=$IMG
kubectl apply -k .
kubectl -n kvorum rollout status deploy/kvorum-api deploy/kvorum-indexer
```

## Rollback

```bash
kubectl -n kvorum rollout undo deploy/kvorum-api
kubectl -n kvorum rollout undo deploy/kvorum-indexer
```

Migrations are not auto-rolled-back; if a migration is the culprit, roll it back with
`pnpm -w db:migrate:down` against the same `DATABASE_URL` before redeploying.

## Scale-up levers (overlay-only — `base/` never changes)

| Want                              | Change                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Survive node loss / reschedule    | Add a node to the pool — soft topology-spread fans API replicas out automatically |
| Handle API traffic                | Raise `maxReplicas` in `base/api-hpa.yaml` (or patch in the overlay)              |
| Dedicated node pools per workload | Add node pools + a `nodeSelector` patch (api→poolA, indexer→poolB)                |
| Conventional ingress + fixed IP   | Swap `components/expose-tunnel` → a DO-LB Ingress component                       |
| Pull ClickHouse back in-cluster   | Point `CLICKHOUSE_*` at a self-hosted StatefulSet — app change is config-only     |

## Future: zero cluster creds in CI

To remove the DO token from GitHub entirely, install **Argo CD** (or Flux) in the cluster and have it pull this repo — CI would only build/push the image and bump the tag. Deferred; the push-based flow above is the minimal-overhead starting point.
