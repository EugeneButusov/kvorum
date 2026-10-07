# Runbook — Production deployment (single-node k3s)

Deploys the full stack — `api` + `indexer` + `ai-worker` + `dashboard`, plus Postgres and ClickHouse — to one DigitalOcean droplet running k3s. Target ≈ **$25/mo**. Rationale and measured capacity: [ADR-0090](../adr/0090-single-node-k3s-topology.md).

## Topology

```
                              ┌─ api.<domain>       ──► kvorum-api        Service ─► api pod
Cloudflare (TLS/DDoS) ─tunnel─┼─ dashboard.<domain> ──► kvorum-dashboard  Service ─► dashboard pod
                              └─ grafana.<domain>   ──► kvorum-grafana    Service ─► grafana pod

  one droplet (s-2vcpu-4gb, k3s)
    api · dashboard · indexer (singleton) · ai-worker (singleton) · cloudflared · prometheus · grafana
    kvorum-postgres (StatefulSet, local-path)   ClusterIP only, no tunnel route
    kvorum-clickhouse (StatefulSet, local-path) ClusterIP only, no tunnel route

External (via kvorum-secrets):  Upstash Redis · Alchemy RPC (+ free fallbacks) · Etherscan · Anthropic/OpenAI
```

The browser only ever talks to the **dashboard** (Next.js SSR + BFF, ADR-084); the dashboard proxies to `kvorum-api` in-cluster via `BACKEND_API_URL`. `api.<domain>` is exposed too for the public/developer API.

| Piece      | Choice                                          | ~ / mo         |
| ---------- | ----------------------------------------------- | -------------- |
| Host       | 1× `s-2vcpu-4gb` droplet, k3s (80 GB SSD incl.) | $24            |
| Postgres   | in-cluster StatefulSet, `local-path`            | $0             |
| ClickHouse | in-cluster StatefulSet, `local-path`            | $0             |
| Snapshots  | weekly droplet snapshot (~10 GB used)           | ~$0.60         |
| Redis      | Upstash (sessions + rate-limiter)               | $0 (free tier) |
| Ingress    | Cloudflare Tunnel (`cloudflared` pod)           | $0             |
| Backups    | Cloudflare R2 (free tier)                       | $0             |
| RPC        | Alchemy free tier + free public fallbacks       | $0             |
| **Total**  |                                                 | **~$24.60**    |

LLM spend is separate and capped in `base/configmap.yaml` (`AI_CAP_*_USD`, $5/mo).

### Capacity

Measured on a 4 GiB single-node k3s cluster (see ADR-0090 for method):

|                                        |                                                        |
| -------------------------------------- | ------------------------------------------------------ |
| Allocatable                            | 4.10 GiB of 4.10 GiB — k3s reserves nothing by default |
| k3s + containerd + kube-system at idle | 511 MiB                                                |
| Full stack memory **requests**         | 2540Mi (60%)                                           |
| Full stack CPU requests                | 1275m of 2000m, plus 200m kube-system                  |

Three things follow, and all of them matter:

- **Set `system-reserved`.** Because k3s reserves nothing, the scheduler cannot see that 511 MiB. Install with `--kubelet-arg=system-reserved=memory=768Mi` or the node can be scheduled into an OOM.
- **Memory limits are overcommitted** (5674Mi against 4096Mi). Requests plus real overhead come to ~3051Mi, so there is ~1 GiB of genuine headroom — but a simultaneous spike to every limit would OOM the node.
- **CPU headroom is thin.** Hourly polling is what makes it comfortable; the indexer is near-idle between ticks. Restoring a fast poll cadence needs a resize first.

If a pod stays `Pending` on memory, resize the droplet — the anti-affinity rules are `preferred` and the topology-spread constraints already exist, so adding a node also works and spreads the request-serving pods off the indexer automatically.

### Process shapes

- `indexer` is a **hard singleton** — `replicas: 1`, `Recreate`, never HPA'd (its chain pollers are not leader-elected). `ai-worker` is likewise a singleton for the same reason, but is mostly idle since LLM work is off-box.
- `api` and `dashboard` carry a **preferred** (not required) anti-affinity against `indexer`. On one node they co-schedule with it; as soon as a node is added they move off it. A required rule would leave the whole set `Pending` forever here.
- `api` and `dashboard` roll with `maxUnavailable: 1 / maxSurge: 0`, because a surge pod has nowhere to land. Each deploy therefore costs ~20s of downtime.
- Both datastores are ClusterIP-only with no tunnel route, so neither is reachable from the internet.

## One-time setup

1. **Droplet** — create one `s-2vcpu-4gb` droplet. Lock the DO Cloud Firewall to SSH only: the Kubernetes API never needs a public port, and ingress arrives through the Cloudflare Tunnel, which dials out.

2. **k3s** — install with Traefik and ServiceLB disabled (ingress is the tunnel pod) and with kubelet reservations set, per the capacity note above:

   ```bash
   sudo groupadd -f k3s
   curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="\
     --disable=traefik \
     --disable=servicelb \
     --kubelet-arg=system-reserved=memory=768Mi,cpu=200m \
     --write-kubeconfig-group=k3s \
     --write-kubeconfig-mode=0640" sh -
   ```

   Verify before going further — `kubectl get node -o json` should report `status.allocatable.memory` **below** `status.capacity.memory`. If they are equal, the reservation did not apply and the node can be scheduled into an OOM.

3. **Datastore credentials** — Postgres and ClickHouse read their users and passwords from `kvorum-secrets` (step 6), and both initialise on first start. No external provisioning, no `CREATE EXTENSION` pre-step: the Postgres image ships pgvector and the app role owns the database, so `ai_003` creates the extension itself.

   Storage comes from k3s's built-in `local-path` StorageClass, i.e. the droplet's own disk. **This means node loss is data loss.** Create the backup bucket and its token now (`R2_*` in step 6), and run a restore drill before putting real data on it — see [`backup-restore.md`](backup-restore.md).

4. **Redis** — create an Upstash Redis database; grab the `rediss://` URL. Kept external deliberately: it is free and it keeps session state off the box.

5. **Cloudflare Tunnel** — in the Zero Trust dashboard create a tunnel, copy the connector **token**, and add **three** public hostname routes on it:
   - `dashboard.<domain>` (and/or the apex) → `http://kvorum-dashboard.kvorum:80` — the human-facing site.
   - `api.<domain>` → `http://kvorum-api.kvorum:80` — the public/developer API.
   - `grafana.<domain>` → `http://kvorum-grafana.kvorum:80` — the cost/health dashboards.

   Postgres and ClickHouse deliberately get **no** route: they are ClusterIP-only and must stay off the internet.

   All routes ride the single `cloudflared` connector; adding a hostname is a Cloudflare-dashboard action only — no manifest change. Point the dashboard's session/SIWE env at these hosts (`SIWE_DOMAIN=dashboard.<domain>`, and `SESSION_COOKIE_DOMAIN=.<domain>` if you want the cookie shared with `api.<domain>`) in `kvorum-secrets`.

6. **In-cluster secret** — create `kvorum-secrets` from the keys documented in
   [`infra/k8s/overlays/prod/secret.example.yaml`](../../infra/k8s/overlays/prod/secret.example.yaml).
   Values live **only** in the cluster — never commit them.

   The datastores initialise from `POSTGRES_*` / `CLICKHOUSE_*` on first start, so **create this secret before the first `apply -k`** — and make sure `DATABASE_URL` embeds the same password, or the apps authenticate against a database that was initialised with a different one.

   ```bash
   kubectl create namespace kvorum
   PGPW=$(openssl rand -hex 24); CHPW=$(openssl rand -hex 24)
   kubectl -n kvorum create secret generic kvorum-secrets \
     --from-literal=POSTGRES_USER='kvorum' \
     --from-literal=POSTGRES_PASSWORD="$PGPW" \
     --from-literal=DATABASE_URL="postgresql://kvorum:$PGPW@kvorum-postgres.kvorum:5432/kvorum" \
     --from-literal=CLICKHOUSE_USER='kvorum' \
     --from-literal=CLICKHOUSE_PASSWORD="$CHPW" \
     --from-literal=CLICKHOUSE_URL='http://kvorum-clickhouse.kvorum:8123' \
     --from-literal=INTERNAL_READ_TOKEN="$(openssl rand -base64 32)" \
     # ...all remaining keys from secret.example.yaml...
     --from-literal=TUNNEL_TOKEN='...'
   ```

   **Public reads:** the API gates every read behind the `ApiKeyGuard` (keyless per-IP reads
   are deferred, ADR-086). `INTERNAL_READ_TOKEN` is the shared secret the dashboard BFF presents
   so anonymous visitors can read — both the API and the dashboard consume it. Without it, every
   dashboard page is empty (the BFF's reads 401). Direct API access still needs a real key.

7. **Deploy user on the droplet** — CI connects as an unprivileged user that can reach k3s:

   ```bash
   sudo adduser --disabled-password --gecos '' deploy
   sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   # paste the CI public key:
   sudo -u deploy tee /home/deploy/.ssh/authorized_keys >/dev/null
   sudo chmod 600 /home/deploy/.ssh/authorized_keys

   # let it read the k3s kubeconfig without being root
   sudo groupadd -f k3s && sudo usermod -aG k3s deploy
   sudo chgrp k3s /etc/rancher/k3s/k3s.yaml && sudo chmod 640 /etc/rancher/k3s/k3s.yaml
   ```

   The `chgrp`/`chmod` are only needed if k3s was installed without the `--write-kubeconfig-*` flags in step 2. Group-readable, not `0644` — a world-readable kubeconfig on a shared host is cluster-admin for every local account.

8. **GitHub `production` environment** (Settings → Environments) — used by `.github/workflows/deploy.yml`:
   - Secret `DEPLOY_HOST` — `deploy@<droplet-ip>`.
   - Secret `DEPLOY_SSH_KEY` — the private half of the key added above.
   - Secret `DEPLOY_KNOWN_HOSTS` — output of `ssh-keyscan <droplet-ip>`. The workflow pins the host key from this rather than using `StrictHostKeyChecking=no`, which would accept a man-in-the-middle on the one channel that can change production.

   These are the **only** credentials CI holds. No app secret is ever exposed to GitHub.

### Chain config

`CHAIN_CONFIG` drives the provider bill more than any other setting. Two rules:

- **List only chains that have a live `dao_source`.** Every configured chain materialises a chain
  context with a `HeadTracker` and per-provider health-check loops — roughly 300 calls/hour —
  whether or not anything polls it. Production polls 3 chains; `.env.example` shows 6.
- **Set `blocksPerMinute` per chain.** Reconcile plugins fall back to `5`, a mainnet figure, so on
  ~2s-block chains the intended 2h recheck gap collapses to ~20min. Aave's voting machines run on
  Polygon and Avalanche, so this is load-bearing here. Use eth 5 / polygon, avalanche, base,
  optimism 30 / arbitrum 240.

Give each chain a free public fallback at `priority: 2`; `libs/chain` fails over on error or open
circuit, so it costs nothing in steady state.

## Deploying

**Automatic** — merge to `main`. `deploy.yml` builds the image and pushes it to GHCR, pins that tag in the prod overlay, copies `infra/k8s` plus the deploy script to the droplet over SSH, and runs [`infra/scripts/deploy.sh`](../../infra/scripts/deploy.sh) there. That script is the whole deploy: bootstrap, migration gate, `apply -k`, rollout waits.

The manual path below runs **the same script**, so there is no second code path to drift.

**Manual deploy (run on the droplet):**

```bash
IMG=ghcr.io/<owner>/kvorum:$(git rev-parse HEAD)   # after the build workflow pushed it
cd infra/k8s/overlays/prod && kustomize edit set image "ghcr.io/kvorum/kvorum=$IMG" && cd -
./infra/scripts/deploy.sh "$IMG"
```

The `kustomize edit` is separate because CI does it on the runner, keeping kustomize off the droplet — `deploy.sh` only needs `kubectl`, which k3s ships. The script refuses to run if the overlay does not pin the tag you asked for, so a stale edit cannot silently ship the wrong build.

Useful overrides: `MIGRATE_TIMEOUT` (default `300s`), `ROLLOUT_TIMEOUT` (`180s`), `KUBECONFIG` (`/etc/rancher/k3s/k3s.yaml`).

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

The `AI_TRIGGER_*_ENABLED` flags in `base/configmap.yaml` are committed as `'true'`, so the worker
starts scanning and spending as soon as the pod is healthy — it does **not** deploy inert. For the
never-spend-before-healthy ordering the steps below assume, set all four to `'false'` first, deploy,
verify, then flip them back. This is the production procedure corresponding to
[`m5-ai-backfill.md`](m5-ai-backfill.md); pair it with [`m5-budget-cap-ops.md`](m5-budget-cap-ops.md)
and [`m5-ai-dlq-triage.md`](m5-ai-dlq-triage.md).

Restarts are safe (#617): the in-flight provider batch and the backfill walk cursor are durable
(`ai_batch` / `ai_backfill_cursor`), so a `rollout restart` / `set env` mid-backfill resumes the batch
and the walk rather than orphaning a paid batch or re-scanning from page 1.

**Prerequisites:** pgvector installed (one-time setup step 2) and `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`
present in `kvorum-secrets` (the worker falls back to sentinel keys and fails only on the first LLM
call otherwise). Budget caps are set in `base/configmap.yaml` (`AI_CAP_*_USD`, $5/mo total).

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
there against the $5 ceiling before/while running the AI backfill (raise the caps first —
$5 will not cover a backfill).

## Scale-up levers (overlay-only — `base/` never changes)

| Want                              | Change                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Survive node loss / reschedule    | Add a node — the preferred anti-affinity and soft topology-spread move api/dashboard off the indexer automatically. Note the datastores use `local-path`, so they do **not** reschedule: that needs a restore, or a networked StorageClass |
| Handle API traffic                | Raise `maxReplicas` in `base/api-hpa.yaml` (or patch in the overlay)                                                                                                                                                                       |
| Handle dashboard traffic          | Add a `dashboard-hpa.yaml` (mirror `api-hpa.yaml`) or raise `replicas` in the overlay                                                                                                                                                      |
| Relieve the shared node           | Add a node — the anti-affinity is preferred, so api/dashboard move off the indexer on their own                                                                                                                                            |
| Dedicated node pools per workload | Add node pools + a `nodeSelector` patch (api→poolA, indexer→poolB)                                                                                                                                                                         |
| Conventional ingress + fixed IP   | Swap `components/expose-tunnel` → a DO-LB Ingress component                                                                                                                                                                                |
| Move a datastore back to managed  | Point `DATABASE_URL` / `CLICKHOUSE_*` at the managed endpoint and drop `components/data` from the overlay — app change is config-only. Restores automatic backups at ~$13–27/mo each                                                       |

## Future: zero cluster creds in CI

To remove the DO token from GitHub entirely, install **Argo CD** (or Flux) in the cluster and have it pull this repo — CI would only build/push the image and bump the tag. Deferred; the push-based flow above is the minimal-overhead starting point.
