# Runbook — Production deployment (DOKS)

Deploys the full stack — `api` + `indexer` + `ai-worker` + `dashboard` — to DigitalOcean Kubernetes. Target ≈ **$50/mo**.

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

- `api` and `dashboard` scale horizontally (api has an HPA; add one for the dashboard when needed). `indexer` is a **hard singleton** — `replicas: 1`, `Recreate`, never HPA'd (its chain pollers aren't leader-elected). `ai-worker` is likewise a **singleton** (`replicas: 1`, `Recreate` — its trigger/backfill scanners aren't leader-elected), but is mostly idle (LLM work is off-box) and carries **no** anti-affinity, so it co-schedules on whichever node has room. If it ever stays `Pending` on memory, add a node (see the capacity note).
- `api` and `dashboard` both carry a required pod anti-affinity against `indexer`, so neither request-serving process shares the indexer's node — on the 2-node pool they land together on node A and the indexer keeps node B to itself.
- **Capacity note:** the 2-node pool now also runs the `ai-worker` (requests 100m CPU / 256 Mi), which co-schedules wherever there is room — typically alongside the indexer on node B. Total requested across both nodes stays well under the 2 vCPU / 4 GB pool for a light demo, but headroom is thin. For real traffic, add a third `s-1vcpu-2gb` node (~+$12/mo) or bump the pool to `s-2vcpu-4gb` — overlay-only, `base/` unchanged. If the worker ever stays `Pending` on memory, that node bump is the fix.

## One-time setup

1. **Cluster** — create a DOKS cluster with a 2-node `s-1vcpu-2gb` pool. Note the cluster name.
2. **Postgres** — create a DO Managed Postgres 18 DB; use the **VPC / private-network** connection string (host starts with `private-`) and add both params: `?sslmode=require&uselibpqcompat=true`. The `uselibpqcompat=true` is **required** — modern `pg` treats bare `sslmode=require` as `verify-full`, which rejects DO's private-CA cert with `SELF_SIGNED_CERT_IN_CHAIN`; this param restores encrypt-without-CA-verify (safe over the private VPC).
   - **pgvector (required before the first deploy carrying the `ai_003` migration).** The AI worker's `proposal_embedding` table is `vector(1536)`, and `ai_003_proposal_embedding.ts` runs `CREATE EXTENSION IF NOT EXISTS vector`. The app/migrate role usually **lacks** `CREATE EXTENSION` on DO Managed PG, so the extension must be created **once as `doadmin`** — `vector` is on DO's supported-extensions list, so no self-hosting is needed. It is created at the **database** level, so after this one step it exists for every role and the migration's `IF NOT EXISTS` is a permanent no-op. If it is missing when `ai_003` runs, the migrate gate **hard-fails and blocks the whole deploy.**
     ```bash
     # check (any role):
     psql "$DATABASE_URL" -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"
     # if no row, create it once as doadmin (connection details → user `doadmin` in the DO panel):
     psql "postgresql://doadmin:<pw>@<host>:25060/kvorum?sslmode=require" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
     ```
     If direct `doadmin` use is disallowed in your org, enable `vector` for the cluster via the DO control panel / DO Support instead.
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
     --from-literal=INTERNAL_READ_TOKEN="$(openssl rand -base64 32)" \
     # ...all keys from secret.example.yaml...
     --from-literal=TUNNEL_TOKEN='...'
   ```
   **Public reads:** the API gates every read behind the `ApiKeyGuard` (keyless per-IP reads
   are deferred, ADR-086). `INTERNAL_READ_TOKEN` is the shared secret the dashboard BFF presents
   so anonymous visitors can read — both the API and the dashboard consume it. Without it, every
   dashboard page is empty (the BFF's reads 401). Direct API access still needs a real key.
7. **GitHub `production` environment** (Settings → Environments) — used by `.github/workflows/deploy.yml`:
   - Secret `DIGITALOCEAN_ACCESS_TOKEN` — a scoped DO API token (read + Kubernetes).
   - Variable `DOKS_CLUSTER` — the cluster name from step 1.

   This DO token is the **only** credential CI holds. No app secret is ever exposed to GitHub.

## Deploying

**Automatic** — merge to `main`. `deploy.yml` builds the image → pushes to GHCR → runs the migration Job and waits (a failed migration aborts the deploy) → rolls api + indexer + ai-worker + dashboard to the new tag → waits for rollout.

**Manual first deploy / from a laptop:**

```bash
IMG=ghcr.io/<owner>/kvorum:$(git rev-parse HEAD)   # after the build workflow pushed it
kubectl -n kvorum delete job kvorum-migrate --ignore-not-found
sed "s#ghcr.io/kvorum/kvorum:latest#$IMG#" infra/k8s/base/migrate-job.yaml | kubectl -n kvorum apply -f -
kubectl -n kvorum wait --for=condition=complete job/kvorum-migrate --timeout=300s
cd infra/k8s/overlays/prod
kustomize edit set image ghcr.io/kvorum/kvorum=$IMG
kubectl apply -k .
kubectl -n kvorum rollout status deploy/kvorum-api deploy/kvorum-indexer deploy/kvorum-ai-worker deploy/kvorum-dashboard
```

## Rollback

```bash
kubectl -n kvorum rollout undo deploy/kvorum-api
kubectl -n kvorum rollout undo deploy/kvorum-indexer
kubectl -n kvorum rollout undo deploy/kvorum-ai-worker
kubectl -n kvorum rollout undo deploy/kvorum-dashboard
```

Migrations are not auto-rolled-back; if a migration is the culprit, roll it back with
`pnpm -w db:migrate:down` against the same `DATABASE_URL` before redeploying.

## Running admin-cli in the cluster (backfill, DLQ, ops)

The image builds the admin-cli to `dist/apps/admin-cli/main.js` (a self-contained esbuild
bundle — `pg`/`kysely`/`@founderpath` resolve from the image's `node_modules`). Run it inside a
pod that carries the secrets — **`kvorum-api` or `kvorum-indexer`, not `kvorum-dashboard`** (the
dashboard has no `kvorum-secrets`). It inherits `DATABASE_URL`, `CLICKHOUSE_URL`, `CHAIN_CONFIG`,
etc. from the pod's env:

```bash
# General form
kubectl -n kvorum exec -it deploy/kvorum-indexer -- node dist/apps/admin-cli/main.js <command>

# Examples
kubectl -n kvorum exec -it deploy/kvorum-indexer -- node dist/apps/admin-cli/main.js backfill run compound --dry-run
kubectl -n kvorum exec -it deploy/kvorum-indexer -- node dist/apps/admin-cli/main.js backfill run compound
```

For a long backfill that must survive a dropped terminal, run it as a one-off Job (same image,
`command: ['node','dist/apps/admin-cli/main.js','backfill','run','compound']`, with the config and
secret wired in via `envFrom`) rather than `exec`. The CLI also runs straight from source when the
built bundle is absent — `node --import tsx apps/admin-cli/src/main.ts <command>` — since
`PKG_VERSION` falls back when the esbuild define isn't present.

## Scoping the live poller (before a backfill)

The live poller advances each source's cursor (`backfill_head_block`) as it ingests, which can seed a
source ahead of a planned backfill — making the backfill `resume` instead of `fresh`. Two controls,
both of which leave **derivation running**:

- **Per-source, durable** — `dao_source.live_polling_enabled` (default `false`). A source stays
  paused — cursor held — until you explicitly `resume` it, which is the deliberate post-backfill
  step: nothing polls (and no cursor advances) until an operator turns it on. It **survives deploys**.
  Toggle via the admin-cli; applies on the next indexer restart:
  ```bash
  # on — after this source's backfill has completed
  kubectl -n kvorum exec deploy/kvorum-indexer -- node dist/apps/admin-cli/main.js daos source resume <dao_source_id>
  # off — pause again (cursor held)
  kubectl -n kvorum exec deploy/kvorum-indexer -- node dist/apps/admin-cli/main.js daos source pause <dao_source_id>
  kubectl -n kvorum rollout restart deploy/kvorum-indexer   # apply
  ```
- **Cluster-wide, temporary** — `INDEXER_LIVE_POLLER_ENABLED=false` disables the poller entirely (env
  override; the pod stays up for admin-cli execs). Reset by the next `apply -k`.

## AI worker: go-live and backfill

The `ai-worker` deploys **inert** — the `AI_TRIGGER_*_ENABLED` flags in `base/configmap.yaml` default
to `'false'`, so the pod is healthy and spends nothing until you turn features on. Bring it live in
three ordered steps; never spend before the pod is confirmed healthy. This is the DOKS translation of
[`m5-ai-backfill.md`](m5-ai-backfill.md); pair it with [`m5-budget-cap-ops.md`](m5-budget-cap-ops.md)
and [`m5-ai-dlq-triage.md`](m5-ai-dlq-triage.md).

Restarts are safe (#617): the in-flight Anthropic batch and the backfill walk cursor are durable
(`ai_batch` / `ai_backfill_cursor`), so a `rollout restart` / `set env` mid-backfill resumes the batch
and the walk rather than orphaning a paid batch or re-scanning from page 1.

**Prerequisites:** pgvector installed (one-time setup step 2) and `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`
present in `kvorum-secrets` (the worker falls back to sentinel keys and fails only on the first LLM
call otherwise). Budget caps are set in `base/configmap.yaml` (`AI_CAP_*_USD`, $17/mo total).

**1 — verify healthy + inert.** After the deploy:

```bash
kubectl -n kvorum rollout status deploy/kvorum-ai-worker
kubectl -n kvorum exec deploy/kvorum-ai-worker -- wget -qO- localhost:9091/health   # green
kubectl -n kvorum logs deploy/kvorum-ai-worker | grep -i queue                      # 4 pg-boss queues created
```

**2 — enable steady-state triggers** (covers new proposals/threads, all DAOs). Flip the four flags to
`'true'` in `base/configmap.yaml` (commit it), or for an immediate change edit the live ConfigMap; env
is injected at pod start, so **restart** to pick it up:

```bash
kubectl -n kvorum edit configmap kvorum-config      # AI_TRIGGER_*_ENABLED: 'true'
kubectl -n kvorum rollout restart deploy/kvorum-ai-worker
```

**3 — one-time historical backfill** (existing corpus; **transient** — set via env, don't commit).
`kubectl set env` itself triggers a rollout. Stage cheap 0.5×-batch + embeddings first, then the 1×
mismatch run:

```bash
# 3a — cheap features, scoped to the demo DAOs
kubectl -n kvorum set env deploy/kvorum-ai-worker \
  AI_BACKFILL_ENABLED=true AI_BACKFILL_SUMMARIZE_ENABLED=true \
  AI_BACKFILL_FORUM_ENABLED=true AI_BACKFILL_EMBED_ENABLED=true \
  AI_BACKFILL_DAOS=compound,aave
kubectl -n kvorum exec deploy/kvorum-ai-worker -- wget -qO- localhost:9091/metrics | grep ai_worker_
# 3b — mismatch (Sonnet 1×, tightest vs the $8 cap) once the cheap features settle
kubectl -n kvorum set env deploy/kvorum-ai-worker AI_BACKFILL_MISMATCH_ENABLED=true
```

Verify coverage (source of truth, not the cursor — see `m5-ai-backfill.md` Phase 4) per feature, then
**turn the backfill off** so only steady-state triggers run:

```bash
kubectl -n kvorum set env deploy/kvorum-ai-worker \
  AI_BACKFILL_ENABLED- AI_BACKFILL_SUMMARIZE_ENABLED- AI_BACKFILL_FORUM_ENABLED- \
  AI_BACKFILL_EMBED_ENABLED- AI_BACKFILL_MISMATCH_ENABLED- AI_BACKFILL_DAOS-
```

Re-trigger a single missed entity with `node dist/apps/admin-cli/main.js ai regenerate <feature> <entity_ref> [--force]`
(run in the ai-worker or indexer pod; the worker must be up so the queues exist).

## Calldata decoder coverage (unblocks mismatch) — #620

The AI **mismatch** detector only runs on a proposal when **every** one of its `proposal_action` rows
is `decode_status = 'decoded'` — a single undecodable action excludes the whole proposal. Governance
proposals call arbitrary contracts the bundled ABI library can't enumerate, so decoder coverage is the
real cap on the mismatch corpus. Enabling **Etherscan enrichment** lets the indexer fetch a target's
verified ABI on demand (and cache it), which also covers proxied targets (it resolves the
implementation address). Steps (operator-run):

```bash
# 1 — size the gap first (mismatch_eligible vs binding); queries are in issue #620.
#     Run against prod PG to confirm the fix targets a real gap and to see the top undecoded selectors.

# 2 — provide the key + enable. ETHERSCAN_ENRICHMENT_ENABLED is already 'true' in base config; set a
#     real key in kvorum-secrets (free tier is fine) and roll the indexer so it re-reads env.
kubectl -n kvorum create secret generic kvorum-secrets \
  --from-literal=ETHERSCAN_API_KEY='REPLACE_ME' --dry-run=client -o yaml | kubectl apply -f -
# (only if you rotate other keys too — otherwise patch just this key via your normal secret flow)
kubectl -n kvorum rollout restart deploy/kvorum-indexer

# 3 — re-queue rows that already exhausted their 10 decode attempts (terminal 'undecodable'); the
#     sweep only picks up 'pending'. --dry-run first to see the count.
kubectl -n kvorum exec deploy/kvorum-indexer -- node dist/apps/admin-cli/main.js \
  derive redecode --dao compound --dao aave --dry-run
kubectl -n kvorum exec deploy/kvorum-indexer -- node dist/apps/admin-cli/main.js \
  derive redecode --dao compound --dao aave --confirm --production

# 4 — watch the sweep drain (decoded outcomes from etherscan/proxy_resolved), then re-run the #620
#     diagnostic: mismatch_eligible should rise toward binding.
kubectl -n kvorum exec deploy/kvorum-indexer -- wget -qO- localhost:9091/metrics \
  | grep -E 'calldata_decode|abi_decode_success'
```

Then re-run the **mismatch backfill** (step 3b above) so the newly-eligible proposals get analysed.
`ETHERSCAN_API_KEY` is already documented in `overlays/prod/secret.example.yaml` and the indexer
already mounts `kvorum-secrets`, so no manifest change is needed beyond setting the value.

## Observability (Grafana + Prometheus)

Cost/health dashboards are self-hosted in-cluster via the `components/monitoring` component
(Prometheus scrapes the apps' `:9091/metrics`; Grafana file-provisions the dashboards). It ships
with the normal `apply -k`. Setup (Grafana admin password + the `grafana.kvorum.watch` tunnel
hostname), dashboards, and verification are in [`observability.md`](observability.md). Watch AI spend
there against the $17 ceiling before/while running the AI backfill.

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
