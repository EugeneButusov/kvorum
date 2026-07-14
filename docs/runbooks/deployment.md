# Runbook — Production deployment (DOKS)

Deploys the full stack — `api` + `indexer` + `dashboard` — to DigitalOcean Kubernetes. Target ≈ **$50/mo**.

## Topology

```
                          ┌─ api.<domain>       ──► kvorum-api        Service ─► api pods       (node A)
Cloudflare (TLS/DDoS) ─tunnel─┤                                                  dashboard pods  (node A)
                          └─ dashboard.<domain> ──► kvorum-dashboard  Service ─┘
                                                    kvorum-indexer    (singleton)  indexer pod  (node B) ← hard split
External (via kvorum-secrets):  Elestio ClickHouse · DO Managed Postgres · Upstash Redis · Alchemy RPC
```

The browser only ever talks to the **dashboard** (Next.js SSR + BFF, ADR-084); the dashboard proxies to
`kvorum-api` in-cluster via `BACKEND_API_URL`. `api.<domain>` is exposed too for the public/developer API.

| Piece      | Choice                                     | ~ / mo         |
| ---------- | ------------------------------------------ | -------------- |
| Cluster    | DOKS, free control plane, 2× `s-1vcpu-2gb` | $24            |
| ClickHouse | Elestio managed (external)                 | $11            |
| Postgres   | DO Managed Postgres 18 (external)          | $15            |
| Redis      | Upstash (sessions + rate-limiter)          | $0 (free tier) |
| Ingress    | Cloudflare Tunnel (`cloudflared` pod)      | $0             |
| **Total**  |                                            | **~$50**       |

- `api` and `dashboard` scale horizontally (api has an HPA; add one for the dashboard when needed). `indexer` is a **hard singleton** — `replicas: 1`, `Recreate`, never HPA'd (its chain pollers aren't leader-elected).
- `api` and `dashboard` both carry a required pod anti-affinity against `indexer`, so neither request-serving process shares the indexer's node — on the 2-node pool they land together on node A and the indexer keeps node B to itself.
- **Capacity note:** node A now runs api + dashboard + cloudflared on 1 vCPU / 2 GB. That fits a light demo (summed requests ≈ 325m CPU / ~550 Mi). For headroom under real traffic, add a third `s-1vcpu-2gb` node (~+$12/mo) or bump the pool to `s-2vcpu-4gb` — overlay-only, `base/` unchanged.

## One-time setup

1. **Cluster** — create a DOKS cluster with a 2-node `s-1vcpu-2gb` pool. Note the cluster name.
2. **Postgres** — create a DO Managed Postgres 18 DB; grab its `DATABASE_URL` (`sslmode=require`).
3. **ClickHouse** — create an Elestio ClickHouse service **in the same region** as DOKS (keeps the write/read hop ~1–5 ms). Note host/user/password; create the `kvorum` database.
4. **Redis** — create an Upstash Redis DB; grab the `rediss://` URL.
5. **Cloudflare Tunnel** — in the Zero Trust dashboard create a tunnel, copy the connector **token**, and add **two** public hostname routes on it:
   - `dashboard.<domain>` (and/or the apex) → `http://kvorum-dashboard.kvorum:80` — the human-facing site.
   - `api.<domain>` → `http://kvorum-api.kvorum:80` — the public/developer API.

   Both routes ride the single `cloudflared` connector; adding the second hostname is a Cloudflare-dashboard action only — no manifest change. Point the dashboard's session/SIWE env at these hosts (`SIWE_DOMAIN=dashboard.<domain>`, and `SESSION_COOKIE_DOMAIN=.<domain>` if you want the cookie shared with `api.<domain>`) in `kvorum-secrets`.

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

**Automatic** — merge to `main`. `deploy.yml` builds the image → pushes to GHCR → runs the migration Job and waits (a failed migration aborts the deploy) → rolls api + indexer + dashboard to the new tag → waits for rollout.

**Manual first deploy / from a laptop:**

```bash
IMG=ghcr.io/<owner>/kvorum:$(git rev-parse HEAD)   # after the build workflow pushed it
kubectl -n kvorum delete job kvorum-migrate --ignore-not-found
sed "s#ghcr.io/kvorum/kvorum:latest#$IMG#" infra/k8s/base/migrate-job.yaml | kubectl -n kvorum apply -f -
kubectl -n kvorum wait --for=condition=complete job/kvorum-migrate --timeout=300s
cd infra/k8s/overlays/prod
kustomize edit set image ghcr.io/kvorum/kvorum=$IMG
kubectl apply -k .
kubectl -n kvorum rollout status deploy/kvorum-api deploy/kvorum-indexer deploy/kvorum-dashboard
```

## Rollback

```bash
kubectl -n kvorum rollout undo deploy/kvorum-api
kubectl -n kvorum rollout undo deploy/kvorum-indexer
kubectl -n kvorum rollout undo deploy/kvorum-dashboard
```

Migrations are not auto-rolled-back; if a migration is the culprit, roll it back with
`pnpm -w db:migrate:down` against the same `DATABASE_URL` before redeploying.

## Scale-up levers (overlay-only — `base/` never changes)

| Want                                  | Change                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Survive node loss / reschedule        | Add a node to the pool — soft topology-spread fans api/dashboard replicas out automatically |
| Handle API traffic                    | Raise `maxReplicas` in `base/api-hpa.yaml` (or patch in the overlay)                        |
| Handle dashboard traffic              | Add a `dashboard-hpa.yaml` (mirror `api-hpa.yaml`) or raise `replicas` in the overlay       |
| Relieve the shared api+dashboard node | Add a third node — the required anti-affinity only pins them off the indexer, not together  |
| Dedicated node pools per workload     | Add node pools + a `nodeSelector` patch (api→poolA, indexer→poolB)                          |
| Conventional ingress + fixed IP       | Swap `components/expose-tunnel` → a DO-LB Ingress component                                 |
| Pull ClickHouse back in-cluster       | Point `CLICKHOUSE_*` at a self-hosted StatefulSet — app change is config-only               |

## Future: zero cluster creds in CI

To remove the DO token from GitHub entirely, install **Argo CD** (or Flux) in the cluster and have it pull this repo — CI would only build/push the image and bump the tag. Deferred; the push-based flow above is the minimal-overhead starting point.
